defmodule NetopsLiveWeb.NocLiveTest do
  use ExUnit.Case, async: false
  import Plug.Conn
  import Phoenix.ConnTest
  import Phoenix.LiveViewTest
  @endpoint NetopsLiveWeb.Endpoint

  @token "test-live-token-0123456789"
  defp user(role), do: Base.url_encode64(Jason.encode!(%{id: "u1", name: "Kade Owner", email: "o@example.test", role: role}), padding: false)

  defp through_hub(role \\ "admin") do
    build_conn() |> put_req_header("x-netops-proxy", @token) |> put_req_header("x-netops-user", user(role))
  end

  @snapshot %{
    "at" => 1_790_000_000_000,
    "online" => %{"total" => 3, "hotspot" => 2, "pppoe" => 1,
      "byRouter" => [%{"name" => "CCR2004", "hotspot" => 2, "pppoe" => 1}],
      "top" => [%{"username" => "pp1000", "name" => "Mary Mutua", "service" => "pppoe", "router" => "CCR2004", "ip" => "10.40.0.9", "since" => 1_789_999_400_000, "down" => 2_500_000_000, "up" => 1_000_000}]},
    "routers" => [%{"name" => "CCR2004", "online" => true, "cpu" => 12, "lastSeen" => 1_790_000_000_000}, %{"name" => "RB951", "online" => false, "lastSeen" => 1_789_990_000_000}],
    "alerts" => [%{"title" => "RB951 is unreachable", "severity" => "critical", "since" => 1_789_990_000_000}],
    "portal" => %{"total" => 1, "hotspot" => 1, "pppoe" => 0},
    "payments" => %{"today" => 1550, "count" => 2, "recent" => [%{"name" => "Mary Mutua", "amount" => 1500, "method" => "mpesa", "at" => 1_789_999_000_000}]}
  }

  test "refuses requests that did not come through the hub" do
    assert build_conn() |> get("/live") |> response(403) =~ "from netops"
    assert build_conn() |> put_req_header("x-netops-proxy", "wrong-token-wrong-token") |> put_req_header("x-netops-user", user("admin")) |> get("/live") |> response(403)
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
    assert render(view) =~ ">42<"

    {:ok, _view, operator_html} = live(through_hub("operator"), "/live")
    refute operator_html =~ "Collected today"
    refute operator_html =~ "KSh 1,550"
  end

  test "helpers" do
    alias NetopsLiveWeb.NocLive
    assert NocLive.money(1_234_567) == "1,234,567"
    assert NocLive.bytes(2_500_000_000) == "2.5 GB"
    assert NocLive.ago(0, 3_600_000 * 2 + 60_000 * 5) == "2 h 5 min ago"
    assert NocLive.clock(0) == "03:00:00"
  end
end
