// 1. Register a button in the main app header to open your UI
// PluginAPI.registerHeaderButton({
//   label: 'Date Range Reporter',
//   icon: 'bar_chart',
//   onClick: () => {
//     // This command renders your index.html inside the main view iframe
//     PluginAPI.showIndexHtmlAsView();
//   },
// });

console.log("[sp-dashboard plugin] Date Range Reporter plugin loaded!");

// We listen to the global Redux ACTION hook.
// Whenever the user adds a task, tracks time, or changes a project, this fires.
// Post a message to our plugin iframe(s). `payload.type` distinguishes the kind.
const postToDashboard = (payload) => {
  document.querySelectorAll('iframe').forEach((iframe) => {
    if (iframe.src && iframe.src.includes('index.html')) {
      iframe.contentWindow.postMessage(payload, '*');
    }
  });
};

// Hook wiring status — reported back to the iframe's Diagnostics panel so it can
// tell "hook registered but idle" from "hook genuinely missing". Both hooks must
// also be declared in manifest.json's "hooks" array or the host won't deliver them.
let actionHookRegistered = false;
let currentTaskHookAvailable = false;
let currentTaskHookRegistered = false;

// We listen to the global Redux ACTION hook.
// Whenever the user adds a task, tracks time, or changes a project, this fires.
// Post a message to our plugin iframe(s). `payload.type` distinguishes the kind.
try {
  PluginAPI.registerHook(PluginAPI.Hooks.ACTION, (action) => {
    console.log("[sp-dashboard plugin] ACTION hook triggered", action.type);
    // Super Productivity renders UI plugins inside sandboxed iframes.
    // Send the iframe a lightweight trigger to refresh its data.
    postToDashboard({ type: 'SP_STATE_CHANGED' });
  });
  actionHookRegistered = true;
} catch (err) {
  console.warn("[sp-dashboard plugin] ACTION hook unavailable:", err);
}

// The most recently seen "current" (actively tracked) task. This lives in the
// host for the whole app session, so it captures a tracking start that happened
// *before* the dashboard iframe was ever opened — the iframe can then ask for it.
let lastCurrentTask = null;

// Dedicated hook: fires the instant the actively tracked ("current") task
// starts, switches, or stops. Payload: { current: Task|null, previous: Task|null }.
// The dashboard only observes this to switch between its Idle and Focus modes —
// it never starts, stops, or changes tracking. Guarded so older SP builds that
// lack the hook still load the plugin cleanly.
try {
  currentTaskHookAvailable = !!(PluginAPI.Hooks && PluginAPI.Hooks.CURRENT_TASK_CHANGE);
  if (currentTaskHookAvailable) {
    PluginAPI.registerHook(PluginAPI.Hooks.CURRENT_TASK_CHANGE, (payload) => {
      const current = (payload && payload.current) || null;
      const previous = (payload && payload.previous) || null;
      console.log("[sp-dashboard plugin] CURRENT_TASK_CHANGE", current && current.id, "<-", previous && previous.id);
      lastCurrentTask = current;
      postToDashboard({ type: 'SP_TRACKING_CHANGED', current, previous });
    });
    currentTaskHookRegistered = true;
  }
} catch (err) {
  currentTaskHookRegistered = false;
  console.warn("[sp-dashboard plugin] CURRENT_TASK_CHANGE hook unavailable:", err);
}

window.addEventListener('message', (event) => {
  if (!event.data) return;
  const src = event.source;

  // A dashboard iframe opened mid-session missed any earlier CURRENT_TASK_CHANGE,
  // so on load it asks us for the current tracking state. Reply straight to that
  // iframe. Only answer when we actually know a task is tracked — a null reply
  // would (correctly) be treated as authoritative and disable the iframe's own
  // delta fallback, which we don't want if we simply never saw the start.
  if (event.data.type === 'SP_REQUEST_TRACKING' && lastCurrentTask && src) {
    src.postMessage({ type: 'SP_TRACKING_CHANGED', current: lastCurrentTask, previous: null }, '*');
  }

  // Diagnostics handshake: prove this companion script is alive and report which
  // hooks actually registered, so the iframe's self-check isn't just guessing.
  if (event.data.type === 'SP_PING' && src) {
    src.postMessage({
      type: 'SP_PONG',
      actionHookRegistered,
      currentTaskHookAvailable,
      currentTaskHookRegistered,
    }, '*');
  }
});
