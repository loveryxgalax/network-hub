import Config

config :netops_live, NetopsLiveWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: 4002],
  secret_key_base: String.duplicate("test-only-secret-key-base-", 4),
  server: false

# The poller is not started in tests; tests push snapshots themselves.
config :netops_live, feed_url: nil, api_url: nil, token: "test-live-token-0123456789", poll_ms: 0, events_ms: 0,
  session_check_ms: 50, session_checker: NetopsLive.TestSessions, allowed_roles: []
config :logger, level: :warning
