defmodule NetopsLiveWeb.Endpoint do
  use Phoenix.Endpoint, otp_app: :netops_live

  @session_options [store: :cookie, key: "_netops_live", path: "/live", signing_salt: "netops-live", same_site: "Lax", secure: true]

  # Browsers reach this only through the hub, which checks the netops sign-in first; the websocket path is
  # /live/live because everything here sits under /live on the public site.
  socket "/live/live", Phoenix.LiveView.Socket,
    websocket: [connect_info: [:x_headers, session: @session_options]],
    longpoll: false

  plug Plug.Static, at: "/live", from: :netops_live, gzip: false, only: NetopsLiveWeb.static_paths()
  plug Plug.RequestId
  plug Plug.Parsers, parsers: [:urlencoded], pass: ["*/*"]
  plug Plug.Head
  plug Plug.Session, @session_options
  plug NetopsLiveWeb.Router
end
