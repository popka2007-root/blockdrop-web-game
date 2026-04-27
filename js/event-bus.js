export class EventBus {
  constructor({ debugKey = "debug-tetris", logger = console } = {}) {
    this.events = new Map();
    this.debugKey = debugKey;
    this.logger = logger;
  }

  on(event, handler) {
    if (!this.events.has(event)) this.events.set(event, []);
    this.events.get(event).push({ handler, once: false });
    return this;
  }

  once(event, handler) {
    if (!this.events.has(event)) this.events.set(event, []);
    this.events.get(event).push({ handler, once: true });
    return this;
  }

  emit(event, data = {}) {
    this.log(event, data);
    const handlers = this.events.get(event);
    if (!handlers?.length) return this;
    this.events.set(
      event,
      handlers.filter((entry) => {
        entry.handler(data);
        return !entry.once;
      }),
    );
    return this;
  }

  off(event, handler) {
    const handlers = this.events.get(event);
    if (!handlers?.length) return this;
    this.events.set(
      event,
      handlers.filter((entry) => entry.handler !== handler),
    );
    return this;
  }

  clear(event) {
    if (event) this.events.delete(event);
    else this.events.clear();
    return this;
  }

  log(event, data) {
    try {
      if (
        typeof localStorage !== "undefined" &&
        localStorage.getItem(this.debugKey)
      ) {
        this.logger.log(`[EVENT] ${event}`, data);
      }
    } catch {
      // Storage can be unavailable in private contexts; event delivery should still work.
    }
  }
}

export const bus = new EventBus();
