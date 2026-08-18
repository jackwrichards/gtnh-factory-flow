package com.gtnhnpc;

import com.google.gson.Gson;
import com.gtnhnpc.AgentTypes.TaskRequest;
import com.gtnhnpc.AgentTypes.TaskResponse;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * The mod's one call into the agent: POST a task, read back a plan.
 *
 * Plain {@link HttpURLConnection} (Java 8, no extra deps) + Gson. This runs on the
 * controller's worker thread, so the long read timeout is fine — a local 27B
 * LLM legitimately takes seconds to reason.
 */
public class AgentBridgeClient {

    private final String baseUrl;
    private final Gson gson = new Gson();

    public AgentBridgeClient(String baseUrl) {
        this.baseUrl = baseUrl;
    }

    /** POST /task and parse the plan back. Throws on transport or HTTP error. */
    public TaskResponse postTask(TaskRequest request) throws IOException {
        URL url = new URL(baseUrl + "/task");
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod("POST");
        conn.setRequestProperty("content-type", "application/json");
        conn.setDoOutput(true);
        conn.setConnectTimeout(5_000);
        // A 27B model can think for a while; give it a long leash.
        conn.setReadTimeout(90_000);

        try (OutputStream out = conn.getOutputStream()) {
            out.write(gson.toJson(request).getBytes(StandardCharsets.UTF_8));
        }

        int code = conn.getResponseCode();
        InputStream in = (code >= 200 && code < 300) ? conn.getInputStream() : conn.getErrorStream();
        String body = readAll(in);
        if (code < 200 || code >= 300) {
            throw new IOException("agent returned HTTP " + code + ": " + body);
        }
        return gson.fromJson(body, TaskResponse.class);
    }

    private static String readAll(InputStream in) throws IOException {
        if (in == null) return "";
        StringBuilder sb = new StringBuilder();
        try (BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
            char[] buf = new char[4096];
            int n;
            while ((n = r.read(buf)) != -1) {
                sb.append(buf, 0, n);
            }
        }
        return sb.toString();
    }
}
