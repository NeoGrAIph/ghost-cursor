module.exports = {
  launch: {
    // Do not pipe browser stdio into this process to avoid adding many
    // listeners on process.stdout/stderr when multiple workers spawn browsers
    dumpio: false,
    headless: true,
    product: 'chrome',
    // Reduce noisy Chromium errors on macOS headless and disable GCM/Push
    // that triggers DEPRECATED_ENDPOINT logs during tests
    args: [
      '--disable-gpu',
      '--disable-background-networking',
      '--disable-features=PushMessaging'
    ]
  },
  browserContext: 'default'
}
