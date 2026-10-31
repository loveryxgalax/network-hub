import Config

if config_env() == :prod do
  token = (System.get_env("NETWORK_LIVE_TOKEN") |> then(&(&1 != "" && &1))) || raise "NETWORK_LIVE_TOKEN is missing (shared with the hub)"
  if byte_size(token) < 24, do: raise("NETWORK_LIVE_TOKEN must be at least 24 characters")

  config :netops_live, NetopsLiveWeb.Endpoint,
    server: true,
    http: [ip: {0, 0, 0, 0}, port: String.to_integer(System.get_env("PORT", "4000"))],
    url: [host: System.get_env("PUBLIC_HOST", "netops.kadenetworks.com"), scheme: "https", port: 443, path: "/live"],
    secret_key_base: (System.get_env("SECRET_KEY_BASE") |> then(&(&1 != "" && &1))) || raise("SECRET_KEY_BASE is missing"),
    # Browsers only reach Phoenix through the hub at the public site.
    check_origin: ["https://" <> System.get_env("PUBLIC_HOST", "netops.kadenetworks.com")]

  config :netops_live,
    feed_url: System.get_env("LIVE_FEED_URL", "http://hub:4319/internal/live"),
    token: token,
    poll_ms: String.to_integer(System.get_env("LIVE_POLL_MS", "3000"))
end
