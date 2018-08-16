import { isArray, isMaybeThenable } from "./utils";
import {
  noop,
  reject,
  fulfill,
  subscribe,
  FULFILLED,
  REJECTED,
  PENDING,
  getThen,
  handleMaybeThenable
} from "./-internal";

import then from "./then";
import Promise from "./promise";
import originalResolve from "./promise/resolve";
import originalThen from "./then";
import { makePromise, PROMISE_ID } from "./-internal";

function validationError() {
  return new Error("Array Methods must be provided an Array");
}

export default class Enumerator {
  constructor(Constructor, input) {
    this._instanceConstructor = Constructor;
    this.promise = new Constructor(noop);
    // 所有传入 promise 必须是本 promise 的实例
    if (!this.promise[PROMISE_ID]) {
      makePromise(this.promise);
    }

    if (isArray(input)) {
      // 一共 all 了几个 promise
      this.length = input.length;
      // 还剩几个没执行完的，初始是所有 promise 的数量
      this._remaining = input.length;
      // 保存结果的数组
      this._result = new Array(this.length);

      if (this.length === 0) {
        fulfill(this.promise, this._result);
      } else {
        this.length = this.length || 0;
        this._enumerate(input);
        // 如果传入的 input 都是同步执行，那么直接在这一轮 event-loop 中就结束了。
        if (this._remaining === 0) {
          fulfill(this.promise, this._result);
        }
      }
    } else {
      // 不是数组直接 reject
      reject(this.promise, validationError());
    }
  }
  _enumerate(input) {
    for (let i = 0; this._state === PENDING && i < input.length; i++) {
      this._eachEntry(input[i], i);
    }
  }

  _eachEntry(entry, i) {
    let c = this._instanceConstructor;
    let { resolve } = c;

    // 如果是本 promise 的 resolve
    if (resolve === originalResolve) {
      let then = getThen(entry);

      // 如果是一个已经 settled 的 promise，则 _remaining--，并记录其结果
      if (then === originalThen && entry._state !== PENDING) {
        this._settledAt(entry._state, i, entry._result);
      }
      // 如果不是一个函数，则 _remaining--，并直接将其作为结果
      else if (typeof then !== "function") {
        this._remaining--;
        this._result[i] = entry;
      }
      // 如果是本 promise 的实例，则设置回调
      else if (c === Promise) {
        let promise = new c(noop);
        handleMaybeThenable(promise, entry, then);
        this._willSettleAt(promise, i);
      }
      // 如果不是本 promise 的实例，则包装一下设置回调
      else {
        this._willSettleAt(new c(resolve => resolve(entry)), i);
      }
    }
    // 如果不是本 promise 的 resolve
    else {
      this._willSettleAt(resolve(entry), i);
    }
  }

  // 同步
  _settledAt(state, i, value) {
    let { promise } = this;

    if (promise._state === PENDING) {
      this._remaining--;
      // 如果有一个 reject，则直接 reject
      if (state === REJECTED) {
        reject(promise, value);
      }
      // 设置结果
      else {
        this._result[i] = value;
      }
    }

    // 如果所有 input 都 settled 了，可以执行 all 的回调了
    if (this._remaining === 0) {
      fulfill(promise, this._result);
    }
  }

  // 通过 then 给 promise 注册 _settledAt
  _willSettleAt(promise, i) {
    let enumerator = this;

    subscribe(
      promise,
      undefined,
      value => enumerator._settledAt(FULFILLED, i, value),
      reason => enumerator._settledAt(REJECTED, i, reason)
    );
  }
}
