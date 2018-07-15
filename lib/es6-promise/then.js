import {
  invokeCallback,
  subscribe,
  FULFILLED,
  REJECTED,
  noop,
  makePromise,
  PROMISE_ID
} from './-internal';

import { asap } from './asap';

export default function then(onFulfillment, onRejection) {
  const parent = this;

  // 创建一个空的 promise
  const child = new this.constructor(noop);

  // ？？？
  if (child[PROMISE_ID] === undefined) {
    makePromise(child);
  }

  const { _state } = parent;

  // 如果当前 promise 已经 settled 了
  // 则可以直接执行 then 的 promise
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
