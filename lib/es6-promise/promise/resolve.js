import {
  noop,
  resolve as _resolve
} from '../-internal';

/**
  `Promise.resolve` returns a promise that will become resolved with the
  passed `value`. It is shorthand for the following:

  ```javascript
  let promise = new Promise(function(resolve, reject){
    resolve(1);
  });

  promise.then(function(value){
    // value === 1
  });
  ```

  Instead of writing the above, your code now simply becomes the following:

  ```javascript
  let promise = Promise.resolve(1);

  promise.then(function(value){
    // value === 1
  });
  ```

  @method resolve
  @static
  @param {Any} value value that the returned promise will be resolved with
  Useful for tooling.
  @return {Promise} a promise that will become fulfilled with the given
  `value`
*/
// 返回一个 promise，并且这个 promise 即将被 resolve 了
export default function resolve(object) {
  /*jshint validthis:true */
  let Constructor = this;

  // 如果传入的就是一个 promise 那么就可以直接返回
  if (object && typeof object === 'object' && object.constructor === Constructor) {
    return object;
  }

  // 生成一个新的 promise
  let promise = new Constructor(noop);
  // 用传入的 value 去 resolve 它
  _resolve(promise, object);
  return promise;
}
