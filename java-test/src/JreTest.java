import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;

/**
 * Petit programme pour verifier qu'un JRE execute un .jar compile.
 * Lancer : java -jar JreTest.jar
 */
public class JreTest {
    public static void main(String[] args) {
        System.out.println("=== Test JRE : OK, le programme Java s'execute ===");
        System.out.println();
        System.out.println("Java        : " + System.getProperty("java.version")
                + " (" + System.getProperty("java.vendor") + ")");
        System.out.println("Runtime     : " + System.getProperty("java.runtime.name"));
        System.out.println("VM          : " + System.getProperty("java.vm.name"));
        System.out.println("Dossier JRE : " + System.getProperty("java.home"));
        System.out.println("OS          : " + System.getProperty("os.name")
                + " " + System.getProperty("os.version")
                + " (" + System.getProperty("os.arch") + ")");
        System.out.println("Utilisateur : " + System.getProperty("user.name"));
        System.out.println("Dossier     : " + System.getProperty("user.dir"));
        System.out.println("Date        : " + new SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(new Date()));

        String version = System.getProperty("java.specification.version", "?");
        System.out.println();
        System.out.println("Version de spec Java : " + version);
        System.out.println("Un portage du workflow (PDFBox) demande Java 8 ou plus.");

        File out = new File("jre-test-resultat.txt");
        try (OutputStreamWriter w = new OutputStreamWriter(
                new FileOutputStream(out), StandardCharsets.UTF_8)) {
            w.write("Ecriture disque OK\r\n");
            w.write("java.version=" + System.getProperty("java.version") + "\r\n");
            w.write("os=" + System.getProperty("os.name") + " " + System.getProperty("os.arch") + "\r\n");
            System.out.println();
            System.out.println("Fichier ecrit : " + out.getAbsolutePath());
        } catch (Exception e) {
            System.out.println();
            System.out.println("ATTENTION : impossible d'ecrire un fichier ici : " + e.getMessage());
        }

        System.out.println();
        System.out.println("Si tu lis ce texte, le JRE peut lancer un programme compile.");
    }
}
