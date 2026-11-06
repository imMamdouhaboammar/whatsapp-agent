# Contract notes

These contracts are proposed and have not been integrated into the application

- worker-bridge.proto: local worker RPCs, version 1. Authentication and socket transport are deployment concerns; define and test them before enabling callers
- events.schema.json: normalized internal event envelope. It deliberately does not replace current UI SSE payloads until versioned adapter tests pass
- A send call that times out after network attempt must produce an uncertain state, even if gRPC reports deadline exceeded
- Deleting protobuf fields requires reserving their numeric tags and names
- No worker should receive an unrestricted absolute filesystem path, SQLite connection, auth directory or Gemini credential
- Every endpoint must enforce size/deadline limits and an explicit authorized caller identity
- Use an official protoc/gRPC generator and current stable versions during implementation; no generated code is included in this design package
