const state = new Map();

function ensure(name, defaultEnabled = true) {
  if (!state.has(name)) state.set(name, { enabled: defaultEnabled });
}

export function gated(name, mw, defaultEnabled = true) {
  ensure(name, defaultEnabled);
  return function (req, res, next) {
    const s = state.get(name);
    if (s && s.enabled) return mw(req, res, next);
    return next();
  };
}

export function list() {
  return Array.from(state.entries()).map(([name, v]) => ({ name, enabled: !!v.enabled }));
}

export function set(name, enabled) {
  ensure(name, true);
  const s = state.get(name);
  s.enabled = !!enabled;
}

export function get(name) {
  const s = state.get(name);
  return s ? !!s.enabled : undefined;
}
