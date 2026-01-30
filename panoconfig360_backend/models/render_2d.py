from pydantic import BaseModel
from typing import Dict, Any


class Render2DRequest(BaseModel):
    buildString: str
    selection: Dict[str, Any]
