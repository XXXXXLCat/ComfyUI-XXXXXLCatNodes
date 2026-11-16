"""ComfyUI embedded infinite canvas extension.

Provides a V3 backend node plus the HTTP endpoints used by the frontend
extension in ``js/``. The frontend registers a canvas mode that reuses
ComfyUI's own LiteGraph engine.
"""

from typing_extensions import override

from comfy_api.latest import ComfyExtension, io

from . import server_routes
from .nodes import InfCanvasAssetLoader

WEB_DIRECTORY = "./js"
__all__ = ["WEB_DIRECTORY"]

VERSION = "0.1.0"


class InfiniteCanvasExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return [InfCanvasAssetLoader]

    @override
    async def on_load(self) -> None:
        server_routes.register_routes()


async def comfy_entrypoint() -> InfiniteCanvasExtension:
    return InfiniteCanvasExtension()
