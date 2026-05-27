// background.js — service worker для управления бейджем на иконке

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'updateBadge') {
    const count = msg.count || 0;
    chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#f5c518' });
    chrome.action.setBadgeTextColor({ color: '#111111' });
  }
});
