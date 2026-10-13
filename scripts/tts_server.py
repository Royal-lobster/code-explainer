#!/usr/bin/env python3
"""Persistent TTS server for Code Explainer.

Usage:
    tts_server.py              Run in the foreground
    tts_server.py --daemon     Start in the background (fails fast if no TTS engine is installed)
    tts_server.py --stop       Stop the running server

The implementation lives in ``codeexplainer.server``; see ``codeexplainer.protocol``
for the wire format.
"""

import sys

from codeexplainer.server import main

if __name__ == "__main__":
    sys.exit(main())
