from pydantic import BaseModel
from typing import Dict, Any

class Render2DRequest(BaseModel):
    client: str
    scene: str
    buildString: str
    selection: Dict[str, Any]
