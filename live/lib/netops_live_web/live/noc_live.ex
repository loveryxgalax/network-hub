defmodule NetopsLiveWeb.NocLive do
  @moduledoc """
  The live NOC screen: customers online, routers, open alerts, captive portal visitors and today's payments.
  Every viewer is subscribed to the one feed process; changes arrive the moment the poller sees them.
  Money is shown to admins only, as in netops.
  """
  use NetopsLiveWeb, :live_view
  alias NetopsLive.Feed

  @impl true
  def mount(_params, _session, socket) do
    if connected?(socket), do: Phoenix.PubSub.subscribe(NetopsLive.PubSub, Feed.topic())
    {snapshot, error} = Feed.latest()
    {:ok, assign(socket, snapshot: snapshot, error: error, page_title: "Live")}
  end

  @impl true
  def handle_info({:snapshot, snapshot}, socket), do: {:noreply, assign(socket, snapshot: snapshot, error: nil)}
  def handle_info({:feed_error, reason}, socket), do: {:noreply, assign(socket, error: reason)}

  @impl true
  def render(%{snapshot: nil} = assigns) do
    ~H"""
    <section class="card empty">
      <h1>Connecting to netops…</h1>
      <p :if={@error}>{@error}</p>
    </section>
    """
  end

  def render(assigns) do
    assigns = assign(assigns, admin: assigns.user["role"] == "admin", s: assigns.snapshot)

    ~H"""
    <p :if={@error} class="stale">Live data paused: {@error}. Showing the last update.</p>
    <section class="tiles">
      <div class="tile blue"><small>Customers online</small><b>{@s["online"]["total"]}</b><em>{@s["online"]["hotspot"]} hotspot · {@s["online"]["pppoe"]} PPPoE</em></div>
      <div class={["tile", routers_down(@s) > 0 && "red"]}><small>Routers up</small><b>{routers_up(@s)} / {length(@s["routers"])}</b><em>{routers_down(@s)} down</em></div>
      <div class={["tile", @s["alerts"] != [] && "amber"]}><small>Open alerts</small><b>{length(@s["alerts"])}</b><em>not resolved</em></div>
      <div class="tile"><small>On the WiFi page now</small><b>{@s["portal"]["total"]}</b><em>{@s["portal"]["hotspot"]} hotspot · {@s["portal"]["pppoe"]} PPPoE</em></div>
      <div :if={@admin} class="tile green"><small>Collected today</small><b>KSh {money(@s["payments"]["today"])}</b><em>{@s["payments"]["count"]} payments</em></div>
    </section>

    <div class="grid">
      <section class="card">
        <h2>Online by router</h2>
        <ul class="bars">
          <li :for={r <- @s["online"]["byRouter"]}>
            <span>{r["name"]}</span>
            <div><i class="hs" style={"width:#{pct(r["hotspot"], @s["online"]["total"])}%"}></i><i class="pp" style={"width:#{pct(r["pppoe"], @s["online"]["total"])}%"}></i></div>
            <b>{r["hotspot"] + r["pppoe"]}</b>
          </li>
        </ul>
        <p :if={@s["online"]["byRouter"] == []} class="muted">Nobody online right now.</p>
      </section>

      <section class="card">
        <h2>Routers</h2>
        <ul class="list">
          <li :for={r <- @s["routers"]}>
            <span class={["dot", r["online"] && "on"]}></span><strong>{r["name"]}</strong>
            <em>{if r["online"], do: "CPU #{r["cpu"] || "—"}%", else: "last seen #{ago(r["lastSeen"], @s["at"])}"}</em>
          </li>
        </ul>
      </section>

      <section class="card">
        <h2>Open alerts</h2>
        <ul class="list">
          <li :for={a <- @s["alerts"]} class={a["severity"]}>
            <span class="dot sev"></span><strong>{a["title"]}</strong><em>{ago(a["since"], @s["at"])}</em>
          </li>
        </ul>
        <p :if={@s["alerts"] == []} class="muted">All clear.</p>
      </section>

      <section :if={@admin} class="card">
        <h2>Payments today</h2>
        <ul class="list">
          <li :for={p <- @s["payments"]["recent"]}><strong>{p["name"]}</strong><b>KSh {money(p["amount"])}</b><em>{p["method"]} · {ago(p["at"], @s["at"])}</em></li>
        </ul>
        <p :if={@s["payments"]["recent"] == []} class="muted">No payments yet today.</p>
      </section>
    </div>

    <section class="card">
      <h2>Top customers online <small>by data downloaded this session</small></h2>
      <table>
        <thead><tr><th>Customer</th><th>Service</th><th>Router</th><th>IP</th><th>Online for</th><th>Down</th><th>Up</th></tr></thead>
        <tbody>
          <tr :for={c <- Enum.take(@s["online"]["top"], 25)}>
            <td><strong>{c["name"] != "" && c["name"] || c["username"]}</strong><small>{c["username"]}</small></td>
            <td>{if c["service"] == "hotspot", do: "Hotspot", else: "PPPoE"}</td>
            <td>{c["router"]}</td><td>{c["ip"]}</td><td>{ago(c["since"], @s["at"], "")}</td>
            <td>{bytes(c["down"])}</td><td>{bytes(c["up"])}</td>
          </tr>
        </tbody>
      </table>
    </section>
    <p class="foot">Updated {clock(@s["at"])} · live, no refresh needed</p>
    """
  end

  defp routers_up(s), do: Enum.count(s["routers"], & &1["online"])
  defp routers_down(s), do: length(s["routers"]) - routers_up(s)
  defp pct(_, 0), do: 0
  defp pct(n, total), do: Float.round(n / total * 100, 1)

  def money(n) when is_number(n), do: n |> round() |> Integer.to_string() |> String.replace(~r/\B(?=(\d{3})+(?!\d))/, ",")
  def money(_), do: "0"

  def bytes(n) when is_number(n) and n >= 1_000_000_000, do: "#{Float.round(n / 1_000_000_000, 1)} GB"
  def bytes(n) when is_number(n) and n >= 1_000_000, do: "#{Float.round(n / 1_000_000, 1)} MB"
  def bytes(n) when is_number(n), do: "#{round(n / 1000)} KB"
  def bytes(_), do: "—"

  def ago(t, now, suffix \\ " ago")
  def ago(t, now, suffix) when is_number(t) and is_number(now) do
    m = max(0, div(round(now - t), 60_000))
    cond do
      m < 1 -> if suffix == "", do: "under a minute", else: "just now"
      m < 60 -> "#{m} min#{suffix}"
      m < 1440 -> "#{div(m, 60)} h #{rem(m, 60)} min#{suffix}"
      true -> "#{div(m, 1440)} d#{suffix}"
    end
  end
  def ago(_, _, _), do: "—"

  # Nairobi time (UTC+3, no daylight saving).
  def clock(at) when is_number(at), do: at |> round() |> Kernel.+(3 * 3_600_000) |> DateTime.from_unix!(:millisecond) |> Calendar.strftime("%H:%M:%S")
  def clock(_), do: "—"
end
