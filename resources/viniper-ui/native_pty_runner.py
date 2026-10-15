"""Establish a controlling terminal and replace this helper with the native CLI.

The parent starts this fresh interpreter in a new session. Keeping ioctl/dup2
out of preexec_fn avoids running Python in a forked multithreaded server.
"""
import fcntl
import os
import sys
import termios


def main() -> None:
    if len(sys.argv) < 3:
        raise SystemExit("PTY helper requires a slave descriptor and executable")
    slave = int(sys.argv[1])
    fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
    os.tcsetpgrp(slave, os.getpgrp())
    for target in (0, 1, 2):
        os.dup2(slave, target)
    if slave > 2:
        os.close(slave)
    try:
        os.execvpe(sys.argv[2], sys.argv[2:], os.environ)
    except OSError as error:
        # Do not print argv or environment: either can contain private data.
        os.write(2, f"\r\nUnable to start native CLI ({error.strerror}).\r\n".encode())
        raise SystemExit(127) from None


if __name__ == "__main__":
    main()
