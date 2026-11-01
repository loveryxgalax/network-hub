defmodule NetopsLiveWeb.NocLiveTest do
  use ExUnit.Case, async: false
  import Plug.Conn
  import Phoenix.ConnTest
  import Phoenix.LiveViewTest
  @endpoint NetopsLiveWeb.Endpoint

  @token "test-live-token-0123456789"
  @sid String.duplicate("a", 64)
  defp user(role, email \\ "o@example.test"), do: Base.url_encode64(Jason.encode!(%{id: "u1", name: "Kade Owner", email: email, role: role}), padding: false)

  # What the hub adds to the page request and, as connect info, to the websocket.
  # LiveViewTest passes the request's x- headers to the websocket as connect info (x_headers), as the hub does.
  defp through_hub(role \\ "admin", sid \\ @sid) do
    build_conn()
    |> put_req_header("x-netops-proxy", @token)
    |> put_req_header("x-netops-user", user(role))
    |> put_req_header("x-netops-session", sid)
  end

  setup do
    NetopsLive.TestSessions.set(@sid, {:ok, true})
    Application.put_env(:netops_live, :allowed_roles, [])
    :ok
  end

  @snapshot %{
    "at" => 1_790_000_000_000,
    "seq" => 3,
    "online" => %{"total" => 3, "hotspot" => 2, "pppoe" => 1,
      "byRouter" => [%{"name" => "CCR2004", "hotspot" => 2, "pppoe" => 1}],
      "top" => [%{"username" => "pp1000", "name" => "Mary Mutua", "service" => "pppoe", "router" => "CCR2004", "ip" => "10.40.0.9", "since" => 1_789_999_400_000, "down" => 2_500_000_000, "up" => 1_000_000}]},
    "routers" => [%{"name" => "CCR2004", "online" => true, "cpu" => 12, "lastSeen" => 1_790_000_000_000}, %{"name" => "RB951", "online" => false, "lastSeen" => 1_789_990_000_000}],
    "alerts" => [%{"title" => "RB951 is unreachable", "severity" => "critical", "since" => 1_789_990_000_000}],
    "portal" => %{"total" => 1, "hotspot" => 1, "pppoe" => 0},
    "payments" => %{"today" => 1550, "count" => 2, "recent" => [%{"name" => "Mary Mutua", "amount" => 1500, "method" => "mpesa", "at" => 1_789_999_000_000}]}
  }

  defp ev(seq, type, extra \\ %{}), do: Map.merge(%{"seq" => seq, "time" => 1_789_999_990_000 + seq, "type" => type, "admin" => false}, extra)

  test "refuses requests that did not come through the hub" do
    assert build_conn() |> get("/live") |> response(403) =~ "from netops"
    assert build_conn() |> put_req_header("x-netops-proxy", "wrong-token-wrong-token") |> put_req_header("x-netops-user", user("admin")) |> get("/live") |> response(403)
    assert build_conn() |> put_req_header("x-netops-proxy", @token) |> put_req_header("x-netops-user", "not-base64!") |> get("/live") |> response(403)
  end

  test "permissions: installers never; LIVE_ROLES limits the rest" do
    assert through_hub("installer") |> get("/live") |> response(403)
    Application.put_env(:netops_live, :allowed_roles, ["admin"])
    assert through_hub("operator") |> get("/live") |> response(403) =~ "limited"
    assert through_hub("admin") |> get("/live") |> response(200)
  end

  test "shows the live numbers, updates when a new snapshot arrives, and hides money from non-admins" do
    NetopsLive.Feed.publish(@snapshot)
    _ = NetopsLive.Feed.latest()
    {:ok, view, html} = live(through_hub(), "/live")
    assert html =~ "Customers online"
    assert html =~ "Mary Mutua"
    assert html =~ "KSh 1,550"
    assert html =~ "RB951 is unreachable"

    NetopsLive.Feed.publish(put_in(@snapshot, ["online", "total"], 42))
    # publish is a cast: a call to the feed returns only after it has broadcast, so the update is already on its way.
    _ = NetopsLive.Feed.latest()
    assert render(view) =~ ">42<"

    {:ok, _view, operator_html} = live(through_hub("operator"), "/live")
    refute operator_html =~ "Collected today"
    refute operator_html =~ "KSh 1,550"
  end

  test "events: catch-up, live updates, lag, payments for admins only, reset" do
    NetopsLive.Feed.publish(@snapshot)
    _ = NetopsLive.Feed.latest()
    now = 1_790_000_000_000
    {events, stats} = NetopsLive.Events.ingest(%{"events" => [ev(1, "router.down", %{"name" => "RB951"}), ev(2, "alert.opened", %{"title" => "RB951 is unreachable"})], "last" => 2, "reset" => false}, now)
    assert Enum.map(events, & &1["seq"]) == [2, 1]
    assert stats.cursor == 2

    {:ok, view, html} = live(through_hub(), "/live")
    assert html =~ "RB951 went offline"

    {_, stats} = NetopsLive.Events.ingest(%{"events" => [ev(2, "alert.opened"), ev(3, "payment.received", %{"admin" => true, "name" => "Mary", "amount" => 500, "method" => "mpesa"}), ev(4, "session.start", %{"name" => "Kim", "router" => "CCR2004"})], "last" => 4, "reset" => false}, now)
    assert stats.cursor == 4
    assert stats.received >= 4
    assert is_integer(stats.lag_ms)
    html = render(view)
    assert html =~ "Payment KSh 500 from Mary"
    assert html =~ "Kim connected on CCR2004"
    assert html =~ "behind"
    # The duplicate seq 2 was not added twice.
    assert length(Regex.scan(~r/Alert: /, html)) == 1

    {:ok, _v, op_html} = live(through_hub("operator"), "/live")
    refute op_html =~ "Payment KSh 500"
    assert op_html =~ "Kim connected"

    {events, stats} = NetopsLive.Events.ingest(%{"events" => [ev(1, "router.up", %{"name" => "RB951"})], "last" => 1, "reset" => true}, now)
    assert Enum.map(events, & &1["type"]) == ["router.up"]
    assert stats.cursor == 1
  end

  test "signing out of netops ends the live view" do
    sid = String.duplicate("b", 64)
    NetopsLive.TestSessions.set(sid, {:ok, true})
    {:ok, view, _} = live(through_hub("admin", sid), "/live")
    NetopsLive.TestSessions.set(sid, {:ok, false})
    assert_redirect(view, "/", 1_000)
  end

  test "the hub cannot be asked three times: the screen closes" do
    sid = String.duplicate("c", 64)
    NetopsLive.TestSessions.set(sid, {:error, "down"})
    {:ok, view, _} = live(through_hub("admin", sid), "/live")
    assert_redirect(view, "/", 1_000)
  end

  test "websocket origin: only the netops site" do
    alias Phoenix.Socket.Transport
    conn = fn origin -> build_conn(:get, "/live/live/websocket") |> put_req_header("origin", origin) end
    assert Transport.check_origin(conn.("https://evil.example"), Phoenix.LiveView.Socket, @endpoint, check_origin: ["https://netops.kadenetworks.com"]).halted
    refute Transport.check_origin(conn.("https://netops.kadenetworks.com"), Phoenix.LiveView.Socket, @endpoint, check_origin: ["https://netops.kadenetworks.com"]).halted
  end

  test "health check answers without the hub headers, on /healthz only" do
    body = build_conn() |> get("/healthz") |> json_response(200)
    assert body["ok"] == true
    assert Map.has_key?(body, "events_lag_ms")
    # Under /live everything still needs the hub headers.
    assert build_conn() |> get("/live") |> response(403)
  end

  test "helpers" do
    alias NetopsLiveWeb.NocLive
    assert NocLive.money(1_234_567) == "1,234,567"
    assert NocLive.bytes(2_500_000_000) == "2.5 GB"
    assert NocLive.ago(0, 3_600_000 * 2 + 60_000 * 5) == "2 h 5 min ago"
    assert NocLive.clock(0) == "03:00:00"
    assert NocLive.describe(%{"type" => "session.stop", "username" => "kim", "cause" => "Idle-Timeout"}) == "kim disconnected (Idle-Timeout)"
    assert NocLive.lag_text(1500, nil) == " · events 1.5 s behind"
    assert NocLive.visible_events([%{"admin" => true}, %{"admin" => false}], false) == [%{"admin" => false}]
  end
end
