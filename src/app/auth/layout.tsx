import GuestGuard from "~/guards/GuestGuard";

type Props = {
	children: React.ReactNode;
};

export default function AuthLayout({ children }: Props) {
	return <GuestGuard>{children}</GuestGuard>;
}
