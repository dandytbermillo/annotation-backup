/**
 * Simple Test Widget for Phase 3.1 Sandbox Testing
 *
 * This widget demonstrates the WidgetBridge API:
 * - Displays a simple UI
 * - Calls WidgetBridge.ready() on load
 * - Shows widget info from WidgetBridge
 * - Has buttons to test various bridge methods
 */

(function() {
  'use strict';

  const root = document.getElementById('widget-root');
  if (!root) {
    console.error('[TestWidget] No widget-root element found');
    return;
  }

  // Create widget UI
  root.innerHTML = `
    <div style="padding: 16px; font-family: system-ui, sans-serif;">
      <h3 style="margin: 0 0 12px; color: #fff;">Test Widget</h3>
      <div id="widget-info" style="font-size: 12px; color: #888; margin-bottom: 16px;"></div>

      <div style="display: flex; flex-direction: column; gap: 8px;">
        <button id="btn-get-panels" style="padding: 8px 12px; border-radius: 4px; border: none; background: #3b82f6; color: white; cursor: pointer;">
          Get Panels (read:workspace)
        </button>
        <button id="btn-get-note" style="padding: 8px 12px; border-radius: 4px; border: none; background: #10b981; color: white; cursor: pointer;">
          Get Current Note (read:notes)
        </button>
        <button id="btn-show-toast" style="padding: 8px 12px; border-radius: 4px; border: none; background: #8b5cf6; color: white; cursor: pointer;">
          Show Toast (ui)
        </button>
        <button id="btn-open-panel" style="padding: 8px 12px; border-radius: 4px; border: none; background: #f59e0b; color: white; cursor: pointer;">
          Open Panel (write:workspace)
        </button>
      </div>

      <div id="result" style="margin-top: 16px; padding: 12px; background: #1f2937; border-radius: 4px; font-size: 12px; color: #9ca3af; white-space: pre-wrap; max-height: 150px; overflow: auto;"></div>
    </div>
  `;

  // Display widget info
  const infoEl = document.getElementById('widget-info');
  if (window.WidgetBridge) {
    infoEl.innerHTML = `
      Widget ID: ${window.WidgetBridge.widgetId}<br>
      Channel ID: ${window.WidgetBridge.channelId.substring(0, 8)}...<br>
      Permissions: ${window.WidgetBridge.permissions.join(', ') || 'none'}
    `;
  } else {
    infoEl.textContent = 'WidgetBridge not available';
  }

  const resultEl = document.getElementById('result');

  function showResult(label, data) {
    resultEl.textContent = label + ':\n' + JSON.stringify(data, null, 2);
  }

  function showError(label, err) {
    resultEl.style.color = '#ef4444';
    resultEl.textContent = label + ' ERROR:\n' + (err.message || err);
    setTimeout(() => { resultEl.style.color = '#9ca3af'; }, 3000);
  }

  // Button handlers
  document.getElementById('btn-get-panels').onclick = async function() {
    try {
      const panels = await window.WidgetBridge.workspace.getPanels();
      showResult('getPanels', panels);
    } catch (err) {
      showError('getPanels', err);
    }
  };

  document.getElementById('btn-get-note').onclick = async function() {
    try {
      const note = await window.WidgetBridge.notes.getCurrentNote();
      showResult('getCurrentNote', note);
    } catch (err) {
      showError('getCurrentNote', err);
    }
  };

  document.getElementById('btn-show-toast').onclick = async function() {
    try {
      await window.WidgetBridge.ui.showToast('Hello from sandbox widget!', 'info');
      showResult('showToast', { success: true });
    } catch (err) {
      showError('showToast', err);
    }
  };

  document.getElementById('btn-open-panel').onclick = async function() {
    try {
      await window.WidgetBridge.workspace.openPanel('recent');
      showResult('openPanel', { success: true, panelId: 'recent' });
    } catch (err) {
      showError('openPanel', err);
    }
  };

  // Signal ready
  if (window.WidgetBridge) {
    window.WidgetBridge.ready();
    console.log('[TestWidget] Ready signal sent');
  }

  console.log('[TestWidget] Initialized successfully');
})();
