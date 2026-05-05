public class Main {
    static int fib(int n) {
        int _tid_7802 = Tracer.enter("fib", n);
        if (n <= 1) return n;
        int left = fib(n - 1);
        int right = fib(n - 2);
        return Tracer.exit(_tid_7802, left + right);
    }

    public static void main(String[] args) {
    try {
        fib(4);
    }

    } finally { Tracer.printResults(); }
}