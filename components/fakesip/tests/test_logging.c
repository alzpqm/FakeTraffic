#define _GNU_SOURCE

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

static struct tm *test_localtime_r(const time_t *timer, struct tm *result);

#define localtime_r test_localtime_r
#include "../src/logging.c"
#undef localtime_r

static int localtime_fails;

static struct tm *test_localtime_r(const time_t *timer, struct tm *result)
{
    (void) timer;

    if (localtime_fails) {
        return NULL;
    }

    memset(result, 0, sizeof(*result));
    result->tm_year = 126;
    result->tm_mon = 7;
    result->tm_mday = 24;
    result->tm_hour = 3;
    result->tm_min = 45;
    result->tm_sec = 6;
    return result;
}

static int fail(const char *message, FILE *stream)
{
    fprintf(stderr, "test_logging: %s\n", message);
    if (stream) {
        fclose(stream);
    }
    return EXIT_FAILURE;
}

int main(void)
{
    char output[512];
    FILE *stream;
    size_t output_len;

    stream = tmpfile();
    if (!stream) {
        return fail("tmpfile failed", NULL);
    }
    g_ctx.logfp = stream;

    localtime_fails = 1;
    fs_logger("test", "test_logging.c", 42, 0, "%s", "fallback works");
    fs_logger_raw("%s", "raw works");
    rewind(stream);
    output_len = fread(output, 1, sizeof(output) - 1U, stream);
    if (ferror(stream)) {
        return fail("could not read logger output", stream);
    }
    output[output_len] = '\0';
    if (!strstr(output, "time unavailable") ||
        !strstr(output, "fallback works") ||
        !strstr(output, "raw works")) {
        return fail("logger output did not use the safe paths", stream);
    }

    if (fclose(stream) < 0) {
        g_ctx.logfp = NULL;
        return fail("fclose failed", NULL);
    }
    g_ctx.logfp = NULL;
    return EXIT_SUCCESS;
}
