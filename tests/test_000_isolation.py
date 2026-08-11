"""Import-time guard for ``unittest discover -s tests``.

The unittest discover command imports modules as top-level ``test_*`` names,
so ``tests/__init__.py`` is not guaranteed to run first.  This module sorts
first and establishes the project-local data root before any later test module
can import ``server``.
"""

from tests._isolation import configure_server_data_root

configure_server_data_root()
