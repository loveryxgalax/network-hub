defmodule KadeLiveWeb.Layouts do
  use KadeLiveWeb, :html

  def root(assigns) do
    ~H"""
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="csrf-token" content={get_csrf_token()} />
        <title>Live · Kade Cloud</title>
        <link rel="stylesheet" href="/live/assets/live.css" />
        <script defer src="/live/assets/phoenix.min.js"></script>
        <script defer src="/live/assets/phoenix_live_view.min.js"></script>
        <script defer src="/live/assets/app.js"></script>
      </head>
      <body>{@inner_content}</body>
    </html>
    """
  end

  def app(assigns) do
    ~H"""
    <header class="bar">
      <a href="/" class="back">← Kade Cloud</a>
      <strong>Kade Networks · Live</strong>
      <span class="who">{@user["name"]}</span>
    </header>
    <main>{@inner_content}</main>
    """
  end
end
