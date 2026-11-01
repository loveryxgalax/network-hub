defmodule NetopsLiveWeb.Proxied do
  @moduledoc """
  Requests must come through the netops hub: it checks the sign-in and adds the shared token, the signed-in user
  and a session id. Anything else (someone reaching the container directly) is refused. When `allowed_roles` is
  set (LIVE_ROLES), other roles are refused here too, on top of the hub's own NETWORK_LIVE_ROLES check.
  """
  import Plug.Conn

  def init(opts), do: opts

  def call(conn, _opts) do
    with [given] <- get_req_header(conn, "x-netops-proxy"),
         true <- valid_token?(given),
         [encoded] <- get_req_header(conn, "x-netops-user"),
         {:ok, user} <- decode_user(encoded) do
      if role_allowed?(user) do
        conn |> assign(:netops_user, user) |> assign(:netops_sid, List.first(get_req_header(conn, "x-netops-session")))
      else
        conn |> send_resp(403, "The live view is limited to some roles. Ask an admin.") |> halt()
      end
    else
      _ -> conn |> send_resp(403, "Open the live view from netops.") |> halt()
    end
  end

  def valid_token?(given), do: is_binary(given) and Plug.Crypto.secure_compare(given, Application.fetch_env!(:netops_live, :token))

  def decode_user(encoded) do
    with {:ok, json} <- Base.url_decode64(encoded, padding: false),
         {:ok, %{"email" => _, "role" => role} = user} when is_binary(role) <- Jason.decode(json) do
      {:ok, Map.take(user, ["id", "name", "email", "role"])}
    else
      _ -> :error
    end
  end

  def role_allowed?(%{"role" => "installer"}), do: false

  def role_allowed?(%{"role" => role}) do
    case Application.get_env(:netops_live, :allowed_roles, []) do
      [] -> true
      roles -> role in roles
    end
  end

  @doc "The user and session id travel to the LiveView inside its signed session."
  def live_session(conn), do: %{"user" => conn.assigns.netops_user, "sid" => conn.assigns[:netops_sid]}

  @doc "On the websocket the hub adds the same headers; both must be present, valid and for the same person."
  def on_mount(:default, _params, %{"user" => user} = session, socket) do
    if Phoenix.LiveView.connected?(socket) do
      headers = Phoenix.LiveView.get_connect_info(socket, :x_headers) || []
      email = user["email"]

      with {_, given} <- List.keyfind(headers, "x-netops-proxy", 0),
           true <- valid_token?(given),
           {_, encoded} <- List.keyfind(headers, "x-netops-user", 0),
           {:ok, %{"email" => ^email} = now} <- decode_user(encoded),
           true <- role_allowed?(now) do
        sid =
          case List.keyfind(headers, "x-netops-session", 0) do
            {_, s} -> s
            nil -> session["sid"]
          end

        {:cont, socket |> Phoenix.Component.assign(:user, now) |> Phoenix.Component.assign(:sid, sid)}
      else
        _ -> {:halt, Phoenix.LiveView.redirect(socket, external: "/")}
      end
    else
      {:cont, socket |> Phoenix.Component.assign(:user, user) |> Phoenix.Component.assign(:sid, session["sid"])}
    end
  end

  def on_mount(:default, _params, _session, socket), do: {:halt, Phoenix.LiveView.redirect(socket, external: "/")}
end
