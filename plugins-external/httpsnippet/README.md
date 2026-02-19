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

Each language supports one or more libraries:

| Language | Libraries |
|---|---|
| C | libcurl |
| Clojure | clj-http |
| C# | HttpClient, RestSharp |
| Go | Native |
| HTTP | HTTP/1.1 |
| Java | AsyncHttp, NetHttp, OkHttp, Unirest |
| JavaScript | Axios, fetch, jQuery, XHR |
| Kotlin | OkHttp |
| Node.js | Axios, fetch, HTTP, Request, Unirest |
| Objective-C | NSURLSession |
| OCaml | CoHTTP |
| PHP | cURL, Guzzle, HTTP v1, HTTP v2 |
| PowerShell | Invoke-WebRequest, RestMethod |
| Python | http.client, Requests |
| R | httr |
| Ruby | Native |
| Shell | cURL, HTTPie, Wget |
| Swift | URLSession |

## Features

- Renders template variables before generating snippets, so the output reflects real values
- Supports all body types: JSON, form-urlencoded, multipart, GraphQL, and raw text
- Includes authentication headers (Basic, Bearer, and API Key)
- Includes query parameters and custom headers
