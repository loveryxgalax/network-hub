import Config

config :netops_live, NetopsLiveWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: 4000],
  secret_key_base: String.duplicate("dev-only-secret-key-base-", 4),
  check_origin: false,
  debug_errors: true

config :netops_live, feed_url: "http://127.0.0.1:4319/internal/live", token: "dev-live-token-0123456789", poll_ms: 3000
