defmodule NetopsLiveWeb.Proxied do
  @moduledoc """
  Requests must come through the netops hub: it checks the sign-in and adds the shared token and the signed-in
  user. Anything else (someone reaching the container directly) is refused.
  """
  import Plug.Conn

  def init(opts), do: opts

  def call(conn, _opts) do
    with [given] <- get_req_header(conn, "x-netops-proxy"),
         true <- valid_token?(given),
         [encoded] <- get_req_header(conn, "x-netops-user"),
         {:ok, user} <- decode_user(encoded) do
      assign(conn, :netops_user, user)
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

  @doc "The user travels to the LiveView inside its signed session."
  def live_session(conn), do: %{"user" => conn.assigns.netops_user}

  @doc "On the websocket the hub adds the same headers; both must be present and valid."
  def on_mount(:default, _params, %{"user" => user}, socket) do
    if Phoenix.LiveView.connected?(socket) do
      headers = Phoenix.LiveView.get_connect_info(socket, :x_headers) || []
      email = user["email"]

      with {_, given} <- List.keyfind(headers, "x-netops-proxy", 0),
           true <- valid_token?(given),
           {_, encoded} <- List.keyfind(headers, "x-netops-user", 0),
           {:ok, %{"email" => ^email}} <- decode_user(encoded) do
        {:cont, Phoenix.Component.assign(socket, :user, user)}
      else
        _ -> {:halt, Phoenix.LiveView.redirect(socket, external: "/")}
      end
    else
      {:cont, Phoenix.Component.assign(socket, :user, user)}
    end
  end

  def on_mount(:default, _params, _session, socket), do: {:halt, Phoenix.LiveView.redirect(socket, external: "/")}
end
