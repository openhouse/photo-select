// bin/apfs-clone.c
<<<<<<< HEAD
// Build: clang -O2 -Wall -Wextra -o bin/apfs-clone bin/apfs-clone.c
#define _DARWIN_C_SOURCE
#include <copyfile.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
=======
// Build: clang -O2 -Wall -Wextra -o apfs-clone bin/apfs-clone.c
#define _DARWIN_C_SOURCE
#include <copyfile.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

static void fail(const char *msg) {
  int err = errno;
  fprintf(stderr, "%s: %s\n", msg, strerror(err));
  exit(err ? err : 1);
}

static void ensure_parent(const char *dst) {
  char *tmp = strdup(dst);
  if (!tmp) fail("strdup");
  char *slash = strrchr(tmp, '/');
  if (slash) {
    *slash = '\0';
    if (*tmp) {
      if (mkdir(tmp, 0777) != 0 && errno != EEXIST) {
        free(tmp);
        fail("mkdir");
      }
    }
  }
  free(tmp);
}
>>>>>>> 0ae3a4d44102f9c967930a22cba4020805285663

int main(int argc, char **argv) {
  if (argc != 3) {
    fprintf(stderr, "usage: apfs-clone SRC DST\n");
    return 2;
  }
<<<<<<< HEAD
  copyfile_flags_t flags = COPYFILE_ALL | COPYFILE_CLONE | COPYFILE_EXCL |
                           COPYFILE_NOFOLLOW_SRC | COPYFILE_NOFOLLOW_DST;
  int rc = copyfile(argv[1], argv[2], NULL, flags);
  if (rc < 0) {
    perror("copyfile(COPYFILE_CLONE)");
    return errno ? errno : 1;
  }
  return 0;
=======
  const char *src = argv[1];
  const char *dst = argv[2];
  ensure_parent(dst);

  int sfd = open(src, O_RDONLY | O_NONBLOCK);
  if (sfd < 0) fail("open(src)");
  int dfd = open(".", O_RDONLY);
  if (dfd < 0) {
    close(sfd);
    fail("open(.)");
  }
  const char *base = strrchr(dst, '/');
  const char *name = base ? base + 1 : dst;
  if (!name || !*name) {
    close(sfd);
    close(dfd);
    fprintf(stderr, "invalid destination path\n");
    return 1;
  }

  unlink(dst);

  int rc = fclonefileat(sfd, dfd, name, 0);
  int err = errno;
  close(sfd);
  close(dfd);
  if (rc == 0) return 0;
  if (err == ENOTSUP || err == EXDEV || err == EINVAL) {
    copyfile_flags_t flags = COPYFILE_ALL | COPYFILE_CLONE | COPYFILE_EXCL |
                             COPYFILE_NOFOLLOW_SRC | COPYFILE_NOFOLLOW_DST;
    int cprc = copyfile(src, dst, NULL, flags);
    if (cprc == 0) return 0;
    err = errno;
    if (err == ENOTSUP || err == EXDEV) {
      return err;
    }
    fail("copyfile(COPYFILE_CLONE)");
  }
  errno = err;
  fail("fclonefileat");
  return err;
>>>>>>> 0ae3a4d44102f9c967930a22cba4020805285663
}
