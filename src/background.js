const SPECIAL_CHARS = '^$&+?.()|{}[]/'.split('');
const MAX_PROFILES_IN_CLOUD = 50;

// In-memory state — mirrors chrome.storage.local (service workers have no localStorage).
let state = {
  isPaused: false,
  lockedTabId: null,
  activeTabId: null,
  currentTabUrl: null,
  profiles: null,
  selectedProfile: 0,
  savedToCloud: false,
};
let currentProfile = { headers: [], respHeaders: [], filters: [], appendMode: false };
let tabUrls = {};

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------
function getLocal(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}
function setLocal(items) {
  return new Promise(resolve => chrome.storage.local.set(items, resolve));
}
function removeLocal(keys) {
  if (typeof keys === 'string') keys = [keys];
  return new Promise(resolve => chrome.storage.local.remove(keys, resolve));
}

async function loadState() {
  const data = await getLocal([
    'isPaused', 'lockedTabId', 'activeTabId', 'currentTabUrl',
    'profiles', 'selectedProfile', 'savedToCloud',
  ]);
  Object.assign(state, {
    isPaused: data.isPaused || false,
    lockedTabId: data.lockedTabId || null,
    activeTabId: data.activeTabId || null,
    currentTabUrl: data.currentTabUrl || null,
    profiles: data.profiles || null,
    selectedProfile: data.selectedProfile || 0,
    savedToCloud: data.savedToCloud || false,
  });
}

// ---------------------------------------------------------------------------
// Profile helpers
// ---------------------------------------------------------------------------
function parseUrlPattern(urlPattern) {
  const joiner = [];
  for (let i = 0; i < urlPattern.length; ++i) {
    let c = urlPattern.charAt(i);
    if (SPECIAL_CHARS.indexOf(c) >= 0) {
      c = '\\' + c;
    } else if (c === '\\') {
      c = '\\\\';
    } else if (c === '*') {
      c = '.*';
    }
    joiner.push(c);
  }
  return joiner.join('');
}

function loadSelectedProfile_() {
  let appendMode = false;
  let headers = [];
  let respHeaders = [];
  let filters = [];

  if (state.profiles) {
    const profiles = JSON.parse(state.profiles);
    const selectedIndex = state.selectedProfile || 0;
    const selectedProfile = profiles[selectedIndex];
    if (!selectedProfile) {
      return { appendMode, headers, respHeaders, filters };
    }

    function filterEnabledHeaders_(hdrs) {
      return (hdrs || [])
        .filter(h => h.enabled && h.name)
        .map(h => ({ name: h.name, value: h.value }));
    }

    for (const filter of (selectedProfile.filters || [])) {
      if (filter.urlPattern) {
        filter.urlRegex = parseUrlPattern(filter.urlPattern);
      }
      filters.push(filter);
    }
    appendMode = selectedProfile.appendMode;
    headers = filterEnabledHeaders_(selectedProfile.headers);
    respHeaders = filterEnabledHeaders_(selectedProfile.respHeaders);
  }

  return { appendMode, headers, respHeaders, filters };
}

// ---------------------------------------------------------------------------
// declarativeNetRequest — replaces webRequest blocking (removed in MV3)
// ---------------------------------------------------------------------------
async function updateDynamicRules() {
  const existingRules = await new Promise(resolve =>
    chrome.declarativeNetRequest.getDynamicRules(resolve)
  );
  const removeIds = existingRules.map(r => r.id);

  if (state.isPaused ||
      (!currentProfile.headers.length && !currentProfile.respHeaders.length)) {
    if (removeIds.length > 0) {
      await new Promise(resolve =>
        chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: removeIds }, resolve)
      );
    }
    return;
  }

  function buildConditions() {
    const urlFilters = currentProfile.filters.filter(
      f => f.enabled && f.type === 'urls' && f.urlRegex
    );
    const typeFilters = currentProfile.filters.filter(
      f => f.enabled && f.type === 'types' && f.resourceType
    );
    const resourceTypes = typeFilters.length > 0
      ? typeFilters.flatMap(f => f.resourceType)
      : undefined;
    const tabIds = state.lockedTabId ? [parseInt(state.lockedTabId)] : undefined;

    if (urlFilters.length === 0) {
      const condition = {};
      if (resourceTypes) condition.resourceTypes = resourceTypes;
      if (tabIds) condition.tabIds = tabIds;
      return [condition];
    }

    return urlFilters.map(f => {
      const condition = { regexFilter: f.urlRegex };
      if (resourceTypes) condition.resourceTypes = resourceTypes;
      if (tabIds) condition.tabIds = tabIds;
      return condition;
    });
  }

  const conditions = buildConditions();
  const operation = currentProfile.appendMode ? 'append' : 'set';
  const rules = [];
  let ruleId = 1;

  if (currentProfile.headers.length > 0) {
    const requestHeaderMods = currentProfile.headers.map(h => ({
      header: h.name, operation, value: h.value,
    }));
    for (const condition of conditions) {
      rules.push({
        id: ruleId++,
        priority: 1,
        action: { type: 'modifyHeaders', requestHeaders: requestHeaderMods },
        condition,
      });
    }
  }

  if (currentProfile.respHeaders.length > 0) {
    const responseHeaderMods = currentProfile.respHeaders.map(h => ({
      header: h.name, operation, value: h.value,
    }));
    for (const condition of conditions) {
      rules.push({
        id: ruleId++,
        priority: 1,
        action: { type: 'modifyHeaders', responseHeaders: responseHeaderMods },
        condition,
      });
    }
  }

  await new Promise(resolve =>
    chrome.declarativeNetRequest.updateDynamicRules(
      { removeRuleIds: removeIds, addRules: rules },
      () => {
        if (chrome.runtime.lastError) {
          console.error('updateDynamicRules error:', chrome.runtime.lastError.message);
        }
        resolve();
      }
    )
  );
}

// ---------------------------------------------------------------------------
// Tab tracking
// ---------------------------------------------------------------------------
function onTabUpdated(tab) {
  if (!tab.active) return;

  let url = tab.url;
  if (url) {
    tabUrls[tab.id] = url;
  } else {
    url = tabUrls[tab.id];
  }
  state.activeTabId = tab.id;
  state.currentTabUrl = null;
  setLocal({ activeTabId: tab.id });
  removeLocal(['currentTabUrl']);

  chrome.windows.get(tab.windowId, {}, (win) => {
    if (chrome.runtime.lastError) return;
    if (win.focused) {
      state.currentTabUrl = url;
      setLocal({ currentTabUrl: url });
    }
  });

  if (!url) return;
  resetBadgeAndContextMenu();
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  onTabUpdated(tab);
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, onTabUpdated);
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  chrome.windows.get(windowId, { populate: true }, (win) => {
    if (chrome.runtime.lastError) return;
    for (const tab of win.tabs) {
      onTabUpdated(tab);
    }
  });
});

// ---------------------------------------------------------------------------
// Cloud backup
// ---------------------------------------------------------------------------
function saveStorageToCloud() {
  chrome.storage.sync.get(null, (items) => {
    const keys = items ? Object.keys(items) : [];
    keys.sort();
    if (keys.length === 0 || items[keys[keys.length - 1]] !== state.profiles) {
      const data = {};
      data[Date.now()] = state.profiles;
      chrome.storage.sync.set(data);
      state.savedToCloud = true;
      setLocal({ savedToCloud: true });
    }
    if (keys.length >= MAX_PROFILES_IN_CLOUD) {
      chrome.storage.sync.remove(keys.slice(0, keys.length - MAX_PROFILES_IN_CLOUD));
    }
  });
}

// ---------------------------------------------------------------------------
// Badge + context menu
// ---------------------------------------------------------------------------
function createContextMenu() {
  if (state.isPaused) {
    chrome.contextMenus.update('pause', {
      title: 'Unpause ModHeader',
      contexts: ['action'],
      onclick: () => {
        state.isPaused = false;
        removeLocal(['isPaused']);
        resetBadgeAndContextMenu();
        updateDynamicRules();
      },
    });
  } else {
    chrome.contextMenus.update('pause', {
      title: 'Pause ModHeader',
      contexts: ['action'],
      onclick: () => {
        state.isPaused = true;
        setLocal({ isPaused: true });
        resetBadgeAndContextMenu();
        updateDynamicRules();
      },
    });
  }

  if (state.lockedTabId) {
    chrome.contextMenus.update('lock', {
      title: 'Unlock to all tabs',
      contexts: ['action'],
      onclick: () => {
        state.lockedTabId = null;
        removeLocal(['lockedTabId']);
        resetBadgeAndContextMenu();
        updateDynamicRules();
      },
    });
  } else {
    chrome.contextMenus.update('lock', {
      title: 'Lock to this tab',
      contexts: ['action'],
      onclick: () => {
        state.lockedTabId = state.activeTabId;
        setLocal({ lockedTabId: state.activeTabId });
        resetBadgeAndContextMenu();
        updateDynamicRules();
      },
    });
  }
}

function resetBadgeAndContextMenu() {
  if (state.isPaused) {
    chrome.action.setIcon({ path: 'icon_bw.png' });
    chrome.action.setBadgeText({ text: '\u275A\u275A' });
    chrome.action.setBadgeBackgroundColor({ color: '#666' });
  } else {
    const numHeaders = currentProfile.headers.length + currentProfile.respHeaders.length;
    if (numHeaders === 0) {
      chrome.action.setBadgeText({ text: '' });
      chrome.action.setIcon({ path: 'icon_bw.png' });
    } else if (state.lockedTabId && state.lockedTabId != state.activeTabId) {
      chrome.action.setIcon({ path: 'icon_bw.png' });
      chrome.action.setBadgeText({ text: '\uD83D\uDD12' });
      chrome.action.setBadgeBackgroundColor({ color: '#ff8e8e' });
    } else {
      chrome.action.setIcon({ path: 'icon.png' });
      chrome.action.setBadgeText({ text: numHeaders.toString() });
      chrome.action.setBadgeBackgroundColor({ color: '#db4343' });
    }
  }
  createContextMenu();
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------
async function initializeStorage() {
  await loadState();
  currentProfile = loadSelectedProfile_();
  await updateDynamicRules();
  resetBadgeAndContextMenu();

  // React to changes made by the popup (writes to chrome.storage.local).
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local') return;
    let stateChanged = false;
    for (const key of Object.keys(changes)) {
      if (key in state) {
        state[key] = changes[key].newValue !== undefined ? changes[key].newValue : null;
        stateChanged = true;
      }
    }
    if (stateChanged) {
      currentProfile = loadSelectedProfile_();
      await updateDynamicRules();
      resetBadgeAndContextMenu();
      if (changes.profiles) {
        saveStorageToCloud();
      }
    }
  });

  if (state.profiles && !state.savedToCloud) {
    saveStorageToCloud();
  }

  // Restore from cloud if no local profiles exist yet.
  if (!state.profiles) {
    chrome.storage.sync.get(null, async (items) => {
      const keys = items ? Object.keys(items) : [];
      keys.sort();
      if (keys.length > 0) {
        state.profiles = items[keys[keys.length - 1]];
        state.savedToCloud = true;
        await setLocal({ profiles: state.profiles, savedToCloud: true });
        currentProfile = loadSelectedProfile_();
        await updateDynamicRules();
        resetBadgeAndContextMenu();
      }
    });
  }
}

// Context menus persist across SW restarts but must be created on first install.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'pause', title: 'Pause', contexts: ['action'] });
  chrome.contextMenus.create({ id: 'lock', title: 'Lock', contexts: ['action'] });
});

initializeStorage();

// ---------------------------------------------------------------------------
// REMOVED in MV3 (kept here as reference, do not restore):
//   - passFilters_(), modifyHeader(), modifyRequestHeaderHandler_(),
//     modifyResponseHeaderHandler_(), getChromeVersion(), setupHeaderModListener()
//     → replaced by declarativeNetRequest.updateDynamicRules()
//   - window.addEventListener('storage', ...) → chrome.storage.onChanged
//   - localStorage.*                          → chrome.storage.local
//   - browser.browserAction.*                 → chrome.action.*
//   - contexts: ['browser_action']            → contexts: ['action']
