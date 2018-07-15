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

function noop() { }

const PENDING = void 0;
const FULFILLED = 1;
const REJECTED = 2;

const TRY_CATCH_ERROR = { error: null };

function selfFulfillment() {
  return new TypeError("You cannot resolve a promise with itself");
}

function cannotReturnOwn() {
  return new TypeError('A promises callback cannot return that same promise.');
}

// 返回可能是 thenable 对象的 then 函数
function getThen(promise) {
  try {
    return promise.then;
  } catch (error) {
    TRY_CATCH_ERROR.error = error;
    return TRY_CATCH_ERROR;
  }
}

function tryThen(then, value, fulfillmentHandler, rejectionHandler) {
  try {
    then.call(value, fulfillmentHandler, rejectionHandler);
  } catch (e) {
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

// promise: 当前的 promise 对象
// thenable: 需要被 fulfill 的一个 thenable 对象
function handleOwnThenable(promise, thenable) {
  if (thenable._state === FULFILLED) {
    // 如果这个 thenable 已经 fulfilled 了，直接 fulfill 当前 promise
    fulfill(promise, thenable._result);
  } else if (thenable._state === REJECTED) {
    // 如果这个 thenable 已经 reject 了，直接 reject 当前 promise
    reject(promise, thenable._result);
  } else {
    // 如果这个 thenable 还没 settled
    // 那么在这个 thenable 执行完后订阅当前 promise 的 resolve 和 reject
    // 然后根据 resolve 的结果再次判断，直到可以 fulfill 或 reject 时，settle 当前 promise 
    subscribe(thenable, undefined, value => resolve(promise, value),
      reason => reject(promise, reason))
  }
}

// promise: 当前的 promise 对象
// maybeThenable: 传入 resolve 的值
// then: thenable.then
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

// promise: 当前 promise 对象
// value: 传入 resolve 的 value
function         (promise, value) {
  if (promise === value) {
    // 自己 resolve 自己会递归爆栈
    reject(promise, selfFulfillment());
  } else if (objectOrFunction(value)) {
    // 处理 thenable 对象，将之执行
    handleMaybeThenable(promise, value, getThen(value));
  } else {
    // 传入基本类型可以直接 fulfill
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

// 将 then 的 promise 的 onFulfillment, onRejection 注册到被 then 的 promise 的 _subscribers 上
// 并且调用尽快开始异步执行
// 每次注册时添加三个对象：下一个 promise，下一个 promise 的 onFulfillment，下一个 promise 的 onRejection
function subscribe(parent, child, onFulfillment, onRejection) {
  let { _subscribers } = parent;
  let { length } = _subscribers;

  parent._onerror = null;

  _subscribers[length] = child;
  _subscribers[length + FULFILLED] = onFulfillment;
  _subscribers[length + REJECTED] = onRejection;

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

  // 每次注册 then 的时候，都是往 _subscribers 添加 promise 和两个回调函数，所以 +3：
  for (let i = 0; i < subscribers.length; i += 3) {
    child = subscribers[i];
    callback = subscribers[i + settled];

    if (child) {
      // 如果被 then 了，则执行子 promise 注册的回调函数
      invokeCallback(settled, child, callback, detail);
    } else {
      // 如果后面没有 then 了，则可以直接执行回调
      callback(detail);
    }
  }

  promise._subscribers.length = 0;
}

// 
function tryCatch(callback, detail) {
  try {
    return callback(detail);
  } catch (e) {
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
  // 如果 then 中传入的 callback 不是函数，则会发生值穿透
  let hasCallback = isFunction(callback),
    value, error, succeeded, failed;

  // then 中传入了函数，可以回调
  if (hasCallback) {
    value = tryCatch(callback, detail);

    if (value === TRY_CATCH_ERROR) {
      failed = true;
      error = value.error;
      value.error = null;
    } else {
      succeeded = true;
    }

    // 防止 promise resolve 自己导致递归爆栈
    if (promise === value) {
      reject(promise, cannotReturnOwn());
      return;
    }

  } else {
    // 发生值穿透，则直接使用之前 promise 传递的值
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
// 但是 new Promise(function(resolve, reject)) 中 resolve 和 reject 的执行是异步的
// 执行到 resolver 中的 resolve 时，实际执行的是 resolve(promise, value)
// 借助闭包多传入了当前的 promise 对象
function initializePromise(promise, resolver) {
  try {
    resolver(function resolvePromise(value) {
      resolve(promise, value);
    }, function rejectPromise(reason) {
      reject(promise, reason);
    });
  } catch (e) {
    reject(promise, e);
  }
}

let id = 0;
function nextId() {
  return id++;
}

// 创建一个未初始化的空的 promise
function makePromise(promise) {
  promise[PROMISE_ID] = id++; // ID
  promise._state = undefined; // promise 的状态
  promise._result = undefined; // settled 后的结果
  promise._subscribers = []; // then 了当前 promise 的之后的 promise
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
