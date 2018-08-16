let len = 0;
let vertxNext;
let customSchedulerFn;

export var asap = function asap(callback, arg) {
  // 入队列注册
  queue[len] = callback;
  queue[len + 1] = arg;
  len += 2;
  if (len === 2) {
    // If len is 2, that means that we need to schedule an async flush.
    // If additional callbacks are queued before the queue is flushed, they
    // will be processed by this flush that we are scheduling.
    // 如果 len 为 2，则任务队列中只有刚加进去的任务，需要开始异步执行
    if (customSchedulerFn) {
      customSchedulerFn(flush);
    } else {
      scheduleFlush();
    }
  }
};

export function setScheduler(scheduleFn) {
  customSchedulerFn = scheduleFn;
}

export function setAsap(asapFn) {
  asap = asapFn;
}

const browserWindow = typeof window !== "undefined" ? window : undefined;
const browserGlobal = browserWindow || {};
const BrowserMutationObserver =
  browserGlobal.MutationObserver || browserGlobal.WebKitMutationObserver;
const isNode =
  typeof self === "undefined" &&
  typeof process !== "undefined" &&
  {}.toString.call(process) === "[object process]";

// test for web worker but not in IE10
const isWorker =
  typeof Uint8ClampedArray !== "undefined" &&
  typeof importScripts !== "undefined" &&
  typeof MessageChannel !== "undefined";

// node
function useNextTick() {
  // node version 0.10.x displays a deprecation warning when nextTick is used recursively
  // see https://github.com/cujojs/when/issues/410 for details
  return () => process.nextTick(flush);
}

// vertx
function useVertxTimer() {
  if (typeof vertxNext !== "undefined") {
    return function() {
      vertxNext(flush);
    };
  }

  return useSetTimeout();
}

function useMutationObserver() {
  let iterations = 0;
  const observer = new BrowserMutationObserver(flush);
  const node = document.createTextNode("");
  observer.observe(node, { characterData: true });

  return () => {
    node.data = iterations = ++iterations % 2;
  };
}

// web worker
function useMessageChannel() {
  const channel = new MessageChannel();
  channel.port1.onmessage = flush;
  return () => channel.port2.postMessage(0);
}

function useSetTimeout() {
  // Store setTimeout reference so es6-promise will be unaffected by
  // other code modifying setTimeout (like sinon.useFakeTimers())
  const globalSetTimeout = setTimeout;
  return () => globalSetTimeout(flush, 1);
}

const queue = new Array(1000);
function flush() {
  for (let i = 0; i < len; i += 2) {
    let callback = queue[i];
    let arg = queue[i + 1];

    callback(arg);

    queue[i] = undefined;
    queue[i + 1] = undefined;
  }

  len = 0;
}

function attemptVertx() {
  try {
    const vertx = Function("return this")().require("vertx");
    vertxNext = vertx.runOnLoop || vertx.runOnContext;
    return useVertxTimer();
  } catch (e) {
    return useSetTimeout();
  }
}

let scheduleFlush;
// Decide what async method to use to triggering processing of queued callbacks:
if (isNode) {
  // Node 环境
  scheduleFlush = useNextTick();
} else if (BrowserMutationObserver) {
  // 支持 MutationObserver 的浏览器
  scheduleFlush = useMutationObserver();
} else if (isWorker) {
  // 支持 MessageChannel 的浏览器或 service worker
  scheduleFlush = useMessageChannel();
} else if (browserWindow === undefined && typeof require === "function") {
  scheduleFlush = attemptVertx(); // https://vertx.io/
} else {
  scheduleFlush = useSetTimeout(); // fallback
}
