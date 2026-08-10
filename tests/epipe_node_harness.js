const force = process.env.VINIPER_NODE_HARNESS_FORCE_EPIPE === "1";
let wrote = false;

function finish(payload) {
  if (wrote) return;
  wrote = true;
  process.stdout.write(JSON.stringify(payload), (error) => {
    if (error && error.code !== "EPIPE") throw error;
  });
}

process.stdout.on("error", (error) => {
  if (error?.code === "EPIPE") {
    process.exitCode = 0;
    return;
  }
  throw error;
});

if (force) {
  process.stdout.emit("error", Object.assign(new Error("fixture broken pipe"), { code: "EPIPE" }));
} else {
  finish({ ok: true, writes: 1 });
  finish({ ok: false, writes: 2 });
}

setImmediate(() => process.exit(process.exitCode || 0));
