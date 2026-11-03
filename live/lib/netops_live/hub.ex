defmodule NetopsLive.Hub do
  @moduledoc """
  The only way Phoenix talks to netops: GET requests to the hub's internal v1 API (private network, shared token).
  Phoenix has no database and never writes; Node stays the only writer.
  """

  @doc "GET `path` (e.g. \"/events?after=10\") from the internal API and decode the JSON body."
  def get(path) do
    case api_url() do
      nil -> {:error, "the hub address is not set"}
      base -> get_url(base <> path)
    end
  end

  def get_url(url) do
    headers = [{~c"authorization", String.to_charlist("Bearer " <> Application.fetch_env!(:netops_live, :token))}]

    case :httpc.request(:get, {String.to_charlist(url), headers}, [timeout: 5_000, connect_timeout: 3_000], body_format: :binary) do
      {:ok, {{_, 200, _}, _, body}} ->
        case Jason.decode(body) do
          {:ok, data} when is_map(data) -> {:ok, data}
          _ -> {:error, "the hub did not return JSON"}
        end

      {:ok, {{_, status, _}, _, _}} -> {:error, "the hub answered #{status}"}
      {:error, reason} -> {:error, "cannot reach the hub (#{inspect(reason)})"}
    end
  end

  @doc "POST JSON to the internal API (actions; Node checks the session and the role, writes and audits)."
  def post(path, data) do
    case api_url() do
      nil -> {:error, "the hub address is not set"}
      base ->
        headers = [{~c"authorization", String.to_charlist("Bearer " <> Application.fetch_env!(:netops_live, :token))}]
        req = {String.to_charlist(base <> path), headers, ~c"application/json", Jason.encode!(data)}

        case :httpc.request(:post, req, [timeout: 8_000, connect_timeout: 3_000], body_format: :binary) do
          {:ok, {{_, status, _}, _, body}} ->
            decoded = case Jason.decode(body) do
              {:ok, m} when is_map(m) -> m
              _ -> %{}
            end
            if status in 200..299, do: {:ok, decoded}, else: {:error, decoded["error"] || "the hub answered #{status}"}

          {:error, reason} -> {:error, "cannot reach the hub (#{inspect(reason)})"}
        end
    end
  end

  @doc "Run an action through Node (tests swap in their own module)."
  def action(sid, action, id), do: Application.get_env(:netops_live, :actions, __MODULE__).run(sid, action, id)
  def run(sid, action, id), do: post("/actions", %{sid: sid, action: action, id: id})

  def api_url, do: Application.get_env(:netops_live, :api_url)
end
