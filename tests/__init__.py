"""Keep unittest discovery away from formal and Preview data roots."""

from ._isolation import configure_server_data_root

configure_server_data_root()
