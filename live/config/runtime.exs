import Config

if config_env() == :prod do
  token = (System.get_env("NETWORK_LIVE_TOKEN") |> then(&(&1 != "" && &1))) || raise "NETWORK_LIVE_TOKEN is missing (shared with the hub)"
  if byte_size(token) < 24, do: raise("NETWORK_LIVE_TOKEN must be at least 24 characters")

  config :netops_live, NetopsLiveWeb.Endpoint,
    server: true,
    http: [ip: {0, 0, 0, 0}, port: String.to_integer(System.get_env("PORT", "4000"))],
    url: [host: System.get_env("PUBLIC_HOST", "netops.kadenetworks.com"), scheme: "https", port: 443],
    secret_key_base: (System.get_env("SECRET_KEY_BASE") |> then(&(&1 != "" && &1))) || raise("SECRET_KEY_BASE is missing"),
    # Browsers only reach Phoenix through the hub at the public site.
    check_origin: ["https://" <> System.get_env("PUBLIC_HOST", "netops.kadenetworks.com")]

  roles = System.get_env("LIVE_ROLES", "") |> String.split(",", trim: true) |> Enum.map(&String.trim/1) |> Enum.reject(&(&1 == ""))

  config :netops_live,
    # Internal v1 API on the hub: /snapshot, /events, /session. LIVE_FEED_URL (old /internal/live) still works.
    api_url: System.get_env("LIVE_API_URL", "http://hub:4319/internal/v1"),
    feed_url: (System.get_env("LIVE_FEED_URL") |> then(&(&1 != "" && &1))) || nil,
    token: token,
    poll_ms: String.to_integer(System.get_env("LIVE_POLL_MS", "3000")),
    events_ms: String.to_integer(System.get_env("LIVE_EVENTS_MS", "1000")),
    session_check_ms: String.to_integer(System.get_env("LIVE_SESSION_CHECK_MS", "30000")),
    # Extra guard on top of the hub's NETWORK_LIVE_ROLES: when set, only these roles may watch.
    allowed_roles: roles
end
