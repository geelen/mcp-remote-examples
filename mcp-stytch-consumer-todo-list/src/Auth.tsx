import {OAuthProviders, OTPMethods, Products, StytchEvent, StytchLoginConfig} from "@stytch/vanilla-js";
import {IdentityProvider, StytchLogin, useStytch, useStytchUser} from "@stytch/react";
import {useEffect} from "react";

export const withLoginRequired = (Component: any) => () =>  {
    const {user, fromCache} = useStytchUser()

    useEffect(() => {
        if (!user && !fromCache) {
            localStorage.setItem('returnTo', window.location.href);
            window.location.href = '/login';
        }
    }, [user, fromCache])

    if (!user) {
        return null
    }
    return <Component/>
}

const useOnLoginComplete = () => {
    return () => {
        const returnTo = localStorage.getItem('returnTo')
        console.log('navigating to: ' + returnTo)
        if (returnTo) {
            localStorage.setItem('returnTo', '');
            window.location.href = returnTo;
        } else {
            window.location.href = '/todoapp';
        }
    }
}

const loginConfig = {
    products: [Products.otp, Products.oauth],
    otpOptions: {
        expirationMinutes: 10,
        methods: [OTPMethods.Email],
    },
    oauthOptions: {
        providers: [{type: OAuthProviders.Google}],
        loginRedirectURL: window.location.origin + '/authenticate',
        signupRedirectURL: window.location.origin + '/authenticate',
    }
} satisfies StytchLoginConfig;

export function Login() {
    const onLoginComplete = useOnLoginComplete();

    const handleOnLoginComplete = (evt: StytchEvent) => {
        if (evt.type !== "AUTHENTICATE_FLOW_COMPLETE") return;
        onLoginComplete();
    }

    return (
        <StytchLogin config={loginConfig} callbacks={{onEvent: handleOnLoginComplete}}/>
    )
}

export const Authorize = withLoginRequired( function () {
    return <IdentityProvider/>
})

export function Authenticate() {
    const client = useStytch();
    const onLoginComplete = useOnLoginComplete();

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const token = params.get('token');
        if (!token) return;

        client.oauth.authenticate(token, {session_duration_minutes: 60})
            .then(onLoginComplete)
    }, [client, onLoginComplete]);

    return (
        <>
            Loading...
        </>
    )
}
