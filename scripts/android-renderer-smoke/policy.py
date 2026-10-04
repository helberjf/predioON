"""Only session writes and the reads required by the resident renderer journey."""
import re


def allows(method, path):
    reads = {"/health", "/auth/me", "/buildings", "/v1/authorization", "/overview/building",
             "/notices", "/finance", "/occurrences"}
    return ((method == "GET" and (path in reads or bool(re.fullmatch(r"/features/buildings/[A-Za-z0-9_-]+", path)))) or
            (method == "POST" and path in {"/auth/login", "/auth/refresh", "/auth/logout"}))
