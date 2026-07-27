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
  const observations = new Map();

  function increment(name, value = 1) {
    counters.set(name, (counters.get(name) || 0) + Number(value || 0));
  }

  function set(name, value) {
    gauges.set(name, Number(value || 0));
  }

  function get(name) {
    return gauges.has(name) ? gauges.get(name) : counters.get(name) || 0;
  }

  function observe(name, value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return;
    const current = observations.get(name) || {
      count: 0,
      sum: 0,
      max: 0,
      samples: [],
    };
    current.count += 1;
    current.sum += number;
    current.max = Math.max(current.max, number);
    current.samples.push(number);
    if (current.samples.length > 2048) current.samples.shift();
    observations.set(name, current);
  }

  function percentile(samples, ratio) {
    if (!samples.length) return 0;
    const ordered = [...samples].sort((a, b) => a - b);
    return ordered[
      Math.min(ordered.length - 1, Math.ceil(ordered.length * ratio) - 1)
    ];
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
    for (const [name, value] of [...observations.entries()].sort()) {
      lines.push(`# TYPE ${name} summary`);
      lines.push(`${name}_count ${value.count}`);
      lines.push(`${name}_sum ${value.sum}`);
      lines.push(`${name}_p50 ${percentile(value.samples, 0.5)}`);
      lines.push(`${name}_p95 ${percentile(value.samples, 0.95)}`);
      lines.push(`${name}_max ${value.max}`);
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
    observe,
    render,
  };
}

module.exports = {
  createLogger,
  createMetrics,
};
