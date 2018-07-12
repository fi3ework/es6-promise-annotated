import {
  objectOrFunction,
  isFunction
} from './utils';

import {
  asap
} from './asap';

import originalThen from './then';
import originalResolve from './promise/resolve';

export const PROMISE_ID = Math.random().toString(36).substring(2);

function noop() {}

const PENDING   = void 0;
const FULFILLED = 1;
const REJECTED  = 2;

const TRY_CATCH_ERROR = { error: null };

function selfFulfillment() {
  return new TypeError("You cannot resolve a promise with itself");
}

function cannotReturnOwn() {
  return new TypeError('A promises callback cannot return that same promise.');
}

function getThen(promise) {
  try {
    return promise.then;
  } catch(error) {
    TRY_CATCH_ERROR.error = error;
    return TRY_CATCH_ERROR;
  }
}

function tryThen(then, value, fulfillmentHandler, rejectionHandler) {
  try {
    then.call(value, fulfillmentHandler, rejectionHandler);
  } catch(e) {
    return e;
  }
}

function handleForeignThenable(promise, thenable, then) {
   asap(promise => {
    var sealed = false;
    var error = tryThen(then, thenable, value => {
      if (sealed) { return; }
      sealed = true;
      if (thenable !== value) {
        resolve(promise, value);
      } else {
        fulfill(promise, value);
      }
    }, reason => {
      if (sealed) { return; }
      sealed = true;

      reject(promise, reason);
    }, 'Settle: ' + (promise._label || ' unknown promise'));

    if (!sealed && error) {
      sealed = true;
      reject(promise, error);
    }
  }, promise);
}

function handleOwnThenable(promise, thenable) {
  if (thenable._state === FULFILLED) {
    fulfill(promise, thenable._result);
  } else if (thenable._state === REJECTED) {
    reject(promise, thenable._result);
  } else {
    subscribe(thenable, undefined, value  => resolve(promise, value),
                                   reason => reject(promise, reason))
  }
}

function handleMaybeThenable(promise, maybeThenable, then) {
  if (maybeThenable.constructor === promise.constructor &&
      then === originalThen &&
      maybeThenable.constructor.resolve === originalResolve) {
    handleOwnThenable(promise, maybeThenable);
  } else {
    if (then === TRY_CATCH_ERROR) {
      reject(promise, TRY_CATCH_ERROR.error);
      TRY_CATCH_ERROR.error = null;
    } else if (then === undefined) {
      fulfill(promise, maybeThenable);
    } else if (isFunction(then)) {
      handleForeignThenable(promise, maybeThenable, then);
    } else {
      fulfill(promise, maybeThenable);
    }
  }
}

// 如果 promise === value 
// 如果是函数或者对象，则可能是一个 thenable 对象
// 如果是一个基本类型，则直接 fulfill
function resolve(promise, value) {
  if (promise === value) {
    reject(promise, selfFulfillment());
  } else if (objectOrFunction(value)) {
    handleMaybeThenable(promise, value, getThen(value));
  } else {
    fulfill(promise, value);
  }
}

function publishRejection(promise) {
  if (promise._onerror) {
    promise._onerror(promise._result);
  }

  publish(promise);
}

// 确定状态为 fulfilled
// 在 fulfilled 自己之后，会 publish 下一个 promise
function fulfill(promise, value) {
  // 每个 promise 只能被 fulfill 或者 reject 一次
  if (promise._state !== PENDING) { return; }

  // 状态变为 fulfilled 并且保存结果
  promise._result = value;
  promise._state = FULFILLED;

  // 如果 promise 后面有 then 的函数，则尽快异步执行下一个 promise
  if (promise._subscribers.length !== 0) {
    asap(publish, promise);
  }
}

// 确定状态为 rejected
function reject(promise, reason) {
  if (promise._state !== PENDING) { return; }
  promise._state = REJECTED;
  promise._result = reason;

  asap(publishRejection, promise);
}

// 将 child 的 onFulfillment, onRejection 注册到 parent 的 _subscribers 上
// 并且调用尽快开始异步执行
// 每次注册时添加三个对象：下一个 promise，下一个 promise 的 onFulfillment，下一个 promise 的 onRejection
function subscribe(parent, child, onFulfillment, onRejection) {
  let { _subscribers } = parent;
  let { length } = _subscribers;

  parent._onerror = null;

  _subscribers[length] = child;
  _subscribers[length + FULFILLED] = onFulfillment;
  _subscribers[length + REJECTED]  = onRejection;

  // 如果前一个 promise 还没有 settled，则补刀？？？
  if (length === 0 && parent._state) {
    asap(publish, parent);
  }
}

// 执行 promise 之后所有 then 的函数
function publish(promise) {
  let subscribers = promise._subscribers;
  let settled = promise._state;

  // 如果后面没有 then 就直接返回
  if (subscribers.length === 0) { return; }

  let child, callback, detail = promise._result;

  // 每次下一个 then 注册的时候，都是往 _subscribers 添加三个：
  for (let i = 0; i < subscribers.length; i += 3) {
    child = subscribers[i];
    callback = subscribers[i + settled];

    if (child) {
      invokeCallback(settled, child, callback, detail);
    } else {
      callback(detail);
    }
  }

  promise._subscribers.length = 0;
}

// 
function tryCatch(callback, detail) {
  try {
    return callback(detail);
  } catch(e) {
    TRY_CATCH_ERROR.error = e;
    return TRY_CATCH_ERROR;
  }
}

// 执行后续 then 中的回调函数
// 上一个 promise 的状态
// 下一个 promise
// 对应状态注册的回调函数
// 上一个 promise 的返回值
function invokeCallback(settled, promise, callback, detail) {
  let hasCallback = isFunction(callback),
      value, error, succeeded, failed;

  if (hasCallback) {
    value = tryCatch(callback, detail);

    if (value === TRY_CATCH_ERROR) {
      failed = true;
      error = value.error;
      value.error = null;
    } else {
      succeeded = true;
    }

    if (promise === value) {
      reject(promise, cannotReturnOwn());
      return;
    }

  } else {
    // 值穿透？？？
    value = detail;
    succeeded = true;
  }

  if (promise._state !== PENDING) {
    // 又重新来一轮，启发链式调用
  } else if (hasCallback && succeeded) {
    resolve(promise, value);
  } else if (failed) {
    reject(promise, error);
  } else if (settled === FULFILLED) {
    fulfill(promise, value);
  } else if (settled === REJECTED) {
    reject(promise, value);
  }
}

// 在 new Promise() 时同步执行 resolver
// 但是 new Prosmise(function(resolve, reject)) 中 resolve 和 reject 的执行是异步的
// 执行到 resovler 中的 resolve 时，实际执行的是 resolve(promise, value)
// 借助闭包多传入了当前的 promise 对象
function initializePromise(promise, resolver) {
  try {
    resolver(function resolvePromise(value){
      resolve(promise, value);
    }, function rejectPromise(reason) {
      reject(promise, reason);
    });
  } catch(e) {
    reject(promise, e);
  }
}

let id = 0;
function nextId() {
  return id++;
}

// 创建一个未初始化的空的 promise
function makePromise(promise) {
  promise[PROMISE_ID] = id++;
  promise._state = undefined;
  promise._result = undefined;
  promise._subscribers = [];
}

export {
  nextId,
  makePromise,
  getThen,
  noop,
  resolve,
  reject,
  fulfill,
  subscribe,
  publish,
  publishRejection,
  initializePromise,
  invokeCallback,
  FULFILLED,
  REJECTED,
  PENDING,
  handleMaybeThenable
};
