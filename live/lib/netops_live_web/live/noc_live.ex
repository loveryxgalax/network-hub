defmodule NetopsLiveWeb.NocLive do
  @moduledoc """
  The live NOC screen: customers online, routers, open alerts, captive portal visitors and today's payments.
  Every viewer is subscribed to the one feed process; changes arrive the moment the poller sees them.
  Money is shown to admins only, as in netops.
  """
  use NetopsLiveWeb, :live_view
  alias NetopsLive.{Feed, Events, Sessions}

  @impl true
  def mount(_params, _session, socket) do
    if connected?(socket) do
      Phoenix.PubSub.subscribe(NetopsLive.PubSub, Feed.topic())
      Phoenix.PubSub.subscribe(NetopsLive.PubSub, Events.topic())
      schedule_session_check()
    end

    {snapshot, error} = Feed.latest()
    {events, stats} = Events.recent()
    {:ok, assign(socket, snapshot: snapshot, error: error, events: events, lag_ms: stats.lag_ms, events_error: stats.error, session_failures: 0, page_title: "Live")}
  end

  @impl true
  def handle_info({:snapshot, snapshot}, socket), do: {:noreply, assign(socket, snapshot: snapshot, error: nil)}
  def handle_info({:feed_error, reason}, socket), do: {:noreply, assign(socket, error: reason)}
  def handle_info({:events, events, meta}, socket), do: {:noreply, assign(socket, events: events, lag_ms: meta.lag_ms, events_error: nil)}

  # Signing out of netops ends the live view: the sign-in is re-checked with the hub every 30 seconds. If the hub
  # cannot be asked three times in a row, the screen closes too (the hub refuses new connections anyway).
  def handle_info(:check_session, socket) do
    case Sessions.checker().check(socket.assigns[:sid]) do
      {:ok, true} ->
        schedule_session_check()
        {:noreply, assign(socket, session_failures: 0)}

      {:ok, false} ->
        {:noreply, redirect(socket, external: "/")}

      {:error, _} ->
        failures = socket.assigns.session_failures + 1
        if failures >= 3, do: {:noreply, redirect(socket, external: "/")}, else: (schedule_session_check(); {:noreply, assign(socket, session_failures: failures)})
    end
  end

  defp schedule_session_check do
    case Application.get_env(:netops_live, :session_check_ms, 30_000) do
      ms when is_integer(ms) and ms > 0 -> Process.send_after(self(), :check_session, ms)
      _ -> :ok
    end
  end

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
      <h2>Activity <small>as it happens</small></h2>
      <ul class="list activity">
        <li :for={e <- visible_events(@events, @admin)} class={kind(e)}>
          <span class="dot sev"></span><strong>{describe(e)}</strong><em>{ago(e["time"], @s["at"])}</em>
        </li>
      </ul>
      <p :if={visible_events(@events, @admin) == []} class="muted">Nothing yet. Alerts, routers going up or down, payments and customers connecting show here.</p>
    </section>

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
    <p class="foot">Updated {clock(@s["at"])} · live, no refresh needed{lag_text(@lag_ms, @events_error)}</p>
    """
  end

  @doc "Money events are for admins only."
  def visible_events(events, admin), do: Enum.reject(events || [], &(&1["admin"] == true and not admin)) |> Enum.take(25)

  def describe(%{"type" => "alert.opened"} = e), do: "Alert: #{e["title"]}"
  def describe(%{"type" => "alert.resolved"} = e), do: "Resolved: #{e["title"]}"
  def describe(%{"type" => "router.down"} = e), do: "#{e["name"]} went offline"
  def describe(%{"type" => "router.up"} = e), do: "#{e["name"]} is back online"
  def describe(%{"type" => "payment.received"} = e), do: "Payment KSh #{money(e["amount"])} from #{e["name"]} (#{e["method"]})"
  def describe(%{"type" => "payment.reversed"} = e), do: "Payment reversed: KSh #{money(e["amount"])} from #{e["name"]}"
  def describe(%{"type" => "ticket.opened"} = e), do: "New ticket: #{e["title"]}"
  def describe(%{"type" => "customer.added"} = e), do: "New customer: #{e["name"]}"
  def describe(%{"type" => "session.start"} = e), do: "#{who(e)} connected on #{e["router"]}"
  def describe(%{"type" => "session.stop"} = e), do: "#{who(e)} disconnected#{if e["cause"] not in [nil, ""], do: " (#{e["cause"]})", else: ""}"
  def describe(%{"type" => t}), do: t
  def describe(_), do: "—"

  defp who(e), do: if(e["name"] not in [nil, ""], do: e["name"], else: e["username"])

  def kind(%{"type" => t}) when t in ["alert.opened", "router.down"], do: "critical"
  def kind(%{"type" => t}) when t in ["alert.resolved", "router.up", "payment.received"], do: "good"
  def kind(_), do: "info"

  def lag_text(_, err) when is_binary(err), do: " · activity paused: #{err}"
  def lag_text(ms, _) when is_number(ms), do: " · events #{Float.round(ms / 1000, 1)} s behind"
  def lag_text(_, _), do: ""

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
