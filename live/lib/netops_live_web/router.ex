defmodule NetopsLiveWeb.Router do
  use NetopsLiveWeb, :router

  pipeline :browser do
    plug :accepts, ["html"]
    plug :fetch_session
    plug NetopsLiveWeb.Proxied
    plug :fetch_live_flash
    plug :put_root_layout, html: {NetopsLiveWeb.Layouts, :root}
    plug :protect_from_forgery
    plug :put_secure_browser_headers, %{
      "content-security-policy" =>
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'"
    }
  end

  scope "/live", NetopsLiveWeb do
    pipe_through :browser

    live_session :noc, session: {NetopsLiveWeb.Proxied, :live_session, []}, on_mount: NetopsLiveWeb.Proxied do
      live "/", NocLive, :index
    end
  end
end
