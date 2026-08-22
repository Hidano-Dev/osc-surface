"""NiceGUI 版コントロールサーフェス。

OSCDesk ブリッジ(Node)と WebSocket で接続し、画面だけを担う。
Unity との OSC I/O はすべてブリッジ側が持つ。接続仕様は docs/BRIDGE_PROTOCOL.md を正とする。
"""

__all__ = ["__version__"]

__version__ = "0.1.0"
