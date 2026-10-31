defmodule NetopsLiveWeb.Layouts do
  use NetopsLiveWeb, :html

  def root(assigns) do
    ~H"""
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="csrf-token" content={get_csrf_token()} />
        <title>Live · Kade Networks netops</title>
        <link rel="stylesheet" href={~p"/live/assets/live.css"} />
        <script defer src={~p"/live/assets/phoenix.min.js"}></script>
        <script defer src={~p"/live/assets/phoenix_live_view.min.js"}></script>
        <script defer src={~p"/live/assets/app.js"}></script>
      </head>
      <body>{@inner_content}</body>
    </html>
    """
  end

  def app(assigns) do
    ~H"""
    <header class="bar">
      <a href="/" class="back">← netops</a>
      <strong>Kade Networks · Live</strong>
      <span class="who">{@user["name"]}</span>
    </header>
    <main>{@inner_content}</main>
    """
  end
end
