function createLogger(base = {}) {
  function write(level, event, fields = {}) {
    const payload = {
      ts: new Date().toISOString(),
      level,
      event,
      ...base,
      ...fields,
    };
    const line = JSON.stringify(payload);
    if (level === "error") console.error(line);
    else console.log(line);
  }

  return {
    info(event, fields) {
      write("info", event, fields);
    },
    warn(event, fields) {
      write("warn", event, fields);
    },
    error(event, fields) {
      write("error", event, fields);
    },
  };
}

function createMetrics() {
  const counters = new Map();
  const gauges = new Map();

  function increment(name, value = 1) {
    counters.set(name, (counters.get(name) || 0) + Number(value || 0));
  }

  function set(name, value) {
    gauges.set(name, Number(value || 0));
  }

  function get(name) {
    return gauges.has(name) ? gauges.get(name) : counters.get(name) || 0;
  }

  function render(extra = {}) {
    const lines = [];
    for (const [name, value] of [...counters.entries()].sort()) {
      lines.push(`# TYPE ${name} counter`);
      lines.push(`${name} ${value}`);
    }
    for (const [name, value] of [...gauges.entries()].sort()) {
      lines.push(`# TYPE ${name} gauge`);
      lines.push(`${name} ${value}`);
    }
    for (const [name, value] of Object.entries(extra).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      lines.push(`# TYPE ${name} gauge`);
      lines.push(`${name} ${Number(value || 0)}`);
    }
    return `${lines.join("\n")}\n`;
  }

  return {
    increment,
    set,
    get,
    render,
  };
}

module.exports = {
  createLogger,
  createMetrics,
};
