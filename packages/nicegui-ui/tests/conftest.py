from __future__ import annotations

import asyncio

import pytest


@pytest.fixture
def run_task():
    """テスト中だけ走らせるバックグラウンドタスクの後始末をまとめる。"""
    tasks: list[asyncio.Task] = []

    def start(coro) -> asyncio.Task:
        task = asyncio.get_running_loop().create_task(coro)
        tasks.append(task)
        return task

    yield start

    for task in tasks:
        task.cancel()
