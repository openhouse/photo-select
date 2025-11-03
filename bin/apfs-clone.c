// bin/apfs-clone.c
// Build: clang -O2 -Wall -Wextra -o bin/apfs-clone bin/apfs-clone.c
#define _DARWIN_C_SOURCE
#include <copyfile.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>

int main(int argc, char **argv) {
  if (argc != 3) {
    fprintf(stderr, "usage: apfs-clone SRC DST\n");
    return 2;
  }
  copyfile_flags_t flags = COPYFILE_ALL | COPYFILE_CLONE | COPYFILE_EXCL |
                           COPYFILE_NOFOLLOW_SRC | COPYFILE_NOFOLLOW_DST;
  int rc = copyfile(argv[1], argv[2], NULL, flags);
  if (rc < 0) {
    perror("copyfile(COPYFILE_CLONE)");
    return errno ? errno : 1;
  }
  return 0;
}
