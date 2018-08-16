import {
  invokeCallback,
  subscribe,
  FULFILLED,
  REJECTED,
  noop,
  makePromise,
  PROMISE_ID
} from "./-internal";

import { asap } from "./asap";

export default function then(onFulfillment, onRejection) {
  const parent = this;

  // 创建一个空的 promise
  const child = new this.constructor(noop);

  // 调用用父 parent 的构造函数生成的 child 不一定是本 Promise 的实例
  // 所以要使用本 Promise 包装一下
  if (child[PROMISE_ID] === undefined) {
    makePromise(child);
  }

  const { _state } = parent;

  // 如果当前 promise 已经 settled 了
  // 则可以直接执行 then 的 promise 的回调函数
  if (_state) {
    const callback = arguments[_state - 1];
    asap(() => invokeCallback(_state, child, callback, parent._result));
  } else {
    // then 前的 promise 作为 parent
    // then 后的 promise 作为 child
    // 将 then 后的 onFulfillment, onRejection 注册到 parent 的 _subscribers 上
    subscribe(parent, child, onFulfillment, onRejection);
  }

  return child;
}
