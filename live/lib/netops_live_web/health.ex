defmodule NetopsLiveWeb.Health do
  @moduledoc """
  GET /healthz for Docker and for checking the service by hand. Only reachable on the private network: the hub
  forwards nothing but /live. Says whether the snapshot feed and the event stream are flowing and how far behind.
  """
  import Plug.Conn

  def init(opts), do: opts

  def call(%Plug.Conn{request_path: "/healthz", method: "GET"} = conn, _opts) do
    now = System.system_time(:millisecond)
    {snapshot, feed_error} = NetopsLive.Feed.latest()
    {_events, ev} = NetopsLive.Events.recent()

    body = %{
      ok: true,
      feed: if(feed_error, do: "error: " <> to_string(feed_error), else: if(snapshot, do: "ok", else: "waiting")),
      snapshot_age_ms: snapshot && is_number(snapshot["at"]) && now - snapshot["at"],
      events: if(ev.error, do: "error: " <> to_string(ev.error), else: if(ev.last_ok_at, do: "ok", else: "waiting")),
      events_cursor: ev.cursor,
      events_lag_ms: ev.lag_ms,
      events_checked_ms_ago: ev.last_ok_at && now - ev.last_ok_at
    }

    conn |> put_resp_content_type("application/json") |> send_resp(200, Jason.encode!(body)) |> halt()
  end

  def call(conn, _opts), do: conn
end
