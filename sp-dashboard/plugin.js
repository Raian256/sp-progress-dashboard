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

PluginAPI.registerHook(PluginAPI.Hooks.ACTION, (action) => {
  console.log("[sp-dashboard plugin] ACTION hook triggered", action.type);
  // Super Productivity renders UI plugins inside sandboxed iframes.
  // Send the iframe a lightweight trigger to refresh its data.
  postToDashboard({ type: 'SP_STATE_CHANGED' });
});

// Dedicated hook: fires the instant the actively tracked ("current") task
// starts, switches, or stops. Payload: { current: Task|null, previous: Task|null }.
// The dashboard only observes this to switch between its Idle and Focus modes —
// it never starts, stops, or changes tracking. Guarded so older SP builds that
// lack the hook still load the plugin cleanly.
try {
  PluginAPI.registerHook(PluginAPI.Hooks.CURRENT_TASK_CHANGE, (payload) => {
    const current = (payload && payload.current) || null;
    const previous = (payload && payload.previous) || null;
    console.log("[sp-dashboard plugin] CURRENT_TASK_CHANGE", current && current.id, "<-", previous && previous.id);
    postToDashboard({ type: 'SP_TRACKING_CHANGED', current, previous });
  });
} catch (err) {
  console.warn("[sp-dashboard plugin] CURRENT_TASK_CHANGE hook unavailable:", err);
}
