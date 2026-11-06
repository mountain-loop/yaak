# Yaak HTTP Snippet Plugin

Generate code snippets for HTTP requests in various languages and frameworks,
powered by [@readme/httpsnippet](https://github.com/readmeio/httpsnippet).

![Httpsnippet plugin](https://assets.yaak.app/uploads/httpsnippet-guiaX_1786x1420.png)

## How It Works

Right-click any HTTP request (or use the `...` menu) and select **Generate Code Snippet**.
A dialog lets you pick a language and library, with a live preview of the generated code.
Click **Copy to Clipboard** to copy the snippet. Your language and library selections are
remembered for next time.

## Supported Languages

Each language supports one or more libraries, listed in the order they appear in the
dialog:

| Language    | Libraries                                 |
| ----------- | ----------------------------------------- |
| Agent       | Agent Prompt                              |
| C           | Libcurl                                   |
| Clojure     | clj-http                                  |
| Crystal     | http::client                              |
| C#          | HttpClient, RestSharp                     |
| Go          | NewRequest                                |
| HTTP        | HTTP/1.1                                  |
| Java        | AsyncHttp, java.net.http, OkHttp, Unirest |
| JavaScript  | XMLHttpRequest, Axios, fetch, jQuery      |
| Kotlin      | OkHttp                                    |
| Node.js     | HTTP, Axios, fetch                        |
| Objective-C | NSURLSession                              |
| OCaml       | CoHTTP                                    |
| PHP         | cURL, Guzzle, HTTP v1, HTTP v2            |
| Powershell  | Invoke-WebRequest, Invoke-RestMethod      |
| Python      | Requests                                  |
| R           | httr                                      |
| Ruby        | net::http, faraday                        |
| Rust        | reqwest                                   |
| Shell       | cURL, HTTPie, Wget                        |
| Swift       | URLSession                                |

The **Agent** target produces a prompt describing the request rather than code, for handing
to an AI coding agent.

## Features

- Renders template variables before generating snippets, so the output reflects real values
- Supports all body types: JSON, form-urlencoded, multipart, GraphQL, and raw text
- Includes authentication headers (Basic, Bearer, and API Key)
- Includes query parameters and custom headers
